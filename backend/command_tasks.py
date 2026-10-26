"""Bounded, read-only queries against the WorkTool source database."""
import json

from datetime import datetime, timedelta
from threading import BoundedSemaphore
from typing import Any, Callable, Dict

RETENTION_DAYS = 2
MAX_COMMANDS = 2000
QUERY_TIMEOUT_MS = 3000
_query_slots = BoundedSemaphore(4)


class CommandQueryBusy(Exception):
    pass


def command_content(raw: Any) -> str:
    """Match frontend commandContent: first command, visible field priority."""
    for _ in range(20):
        for _ in range(2):
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except (ValueError, TypeError):
                    return ""
        if isinstance(raw, list):
            first = raw[0] if raw else None
        elif isinstance(raw, dict):
            if isinstance(raw.get("list"), list):
                first = raw["list"][0] if raw["list"] else None
            elif raw.get("body") is not None:
                raw = raw["body"]
                continue
            else:
                first = raw
        else:
            return ""
        if not isinstance(first, dict):
            return ""
        return str(first.get("receivedContent") or first.get("extraText") or
                   first.get("objectName") or first.get("fileUrl") or "").strip()
    return ""


def list_command_tasks(connect: Callable, robot_id: str, status: str, page: int, size: int, message_id: str = "", content: str = "") -> Dict[str, Any]:
    if status not in ("all", "success", "failed"):
        raise ValueError("invalid command status")
    if page < 1 or not 1 <= size <= 200:
        raise ValueError("invalid pagination")
    # Do not queue DB work or occupy all of FastAPI's worker threads under load.
    if not _query_slots.acquire(blocking=False):
        raise CommandQueryBusy()
    try:
        return _query_command_tasks(connect, robot_id, status, page, size, message_id, content.strip())
    finally:
        _query_slots.release()


def _query_command_tasks(connect: Callable, robot_id: str, status: str, page: int, size: int, message_id: str, content: str) -> Dict[str, Any]:
    cutoff = (datetime.now() - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    params = [robot_id, cutoff]
    exact = ""
    if message_id:
        # Exact lookup must not bypass the shared time/record boundary.
        exact = " AND message_id=%s"
        params.append(message_id)
    # InnoDB's robot_id secondary index includes the primary key id.
    # LIMIT precedes the time predicate so an inactive robot cannot scan its
    # entire history looking for 2000 qualifying records.
    scope = f"""WITH recent AS (
        SELECT id,robot_id,message_id,create_time
        FROM raw_message_record FORCE INDEX(robot_id)
        WHERE robot_id=%s ORDER BY id DESC LIMIT {MAX_COMMANDS}
    ), scoped AS (
        SELECT * FROM recent WHERE create_time>=%s{exact}
    ) """
    latest_join = """LEFT JOIN raw_msg_confirm r ON r.id=(
        SELECT r2.id FROM raw_msg_confirm r2 FORCE INDEX(robot_id_2)
        WHERE r2.robot_id=c.robot_id AND r2.message_id=c.message_id
        ORDER BY r2.run_time DESC,r2.id DESC LIMIT 1
    )"""
    status_where = "raw_success=0" if status == "success" else "raw_success<>0"
    select = f"SELECT /*+ MAX_EXECUTION_TIME({QUERY_TIMEOUT_MS}) */"
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            cur.execute("START TRANSACTION READ ONLY")
            if content:
                # Read only bounded bodies, in the same snapshot as count/page.
                cur.execute(scope + f"{select} c.id,c.body FROM scoped s "
                            "JOIN raw_message_record c ON c.id=s.id", tuple(params))
                keyword = content.casefold()
                matched = [row["id"] for row in cur.fetchall()
                           if keyword in command_content(row["body"]).casefold()]
                if not matched:
                    return {"items": [], "total": 0, "page": page, "size": size,
                            "scope": {"days": RETENTION_DAYS, "max_commands": MAX_COMMANDS, "since": cutoff}}
                scope = scope.replace("create_time>=%s", "create_time>=%s AND id IN (" +
                                      ",".join(["%s"] * len(matched)) + ")")
                params[2:2] = matched
            filtered_scope = scope.rstrip() + f""", resolved AS (
                SELECT c.id,c.create_time,r.id result_id,r.raw_success,r.run_time
                FROM scoped c {latest_join}
            ) """
            if status == "all":
                cur.execute(scope + f"{select} COUNT(*) total FROM scoped", tuple(params))
                total = int(cur.fetchone()["total"])
                # Only read bodies and receipts for the requested page.
                page_sql = """SELECT id,create_time FROM scoped
                    ORDER BY create_time DESC,id DESC LIMIT %s OFFSET %s"""
                sql = scope + f"""{select} c.*,r.id AS result_id,r.raw_success,r.error_reason,r.run_time,
                    r.type,r.success_list,r.fail_list,r.time_cost
                    FROM ({page_sql}) p JOIN raw_message_record c ON c.id=p.id
                    {latest_join} ORDER BY p.create_time DESC,p.id DESC"""
            else:
                # Determine latest receipt before status filtering, on at most
                # MAX_COMMANDS commands rather than every historical receipt.
                page_sql = f"""SELECT id,result_id,run_time,COUNT(*) OVER() total FROM resolved
                    WHERE {status_where}
                    ORDER BY run_time DESC,id DESC LIMIT %s OFFSET %s"""
                sql = filtered_scope + f"""{select} c.*,p.total,r.id AS result_id,r.raw_success,r.error_reason,r.run_time,
                    r.type,r.success_list,r.fail_list,r.time_cost
                    FROM ({page_sql}) p JOIN raw_message_record c ON c.id=p.id
                    JOIN raw_msg_confirm r ON r.id=p.result_id
                    ORDER BY p.run_time DESC,p.id DESC"""
            cur.execute(sql, tuple(params + [size, (page - 1) * size]))
            records = cur.fetchall()
            if status != "all":
                if records:
                    total = int(records[0]["total"])
                elif page == 1:
                    total = 0
                else:
                    cur.execute(filtered_scope + f"{select} COUNT(*) total FROM resolved WHERE {status_where}", tuple(params))
                    total = int(cur.fetchone()["total"])
        items = []
        for row in records:
            command = {"robotId": row["robot_id"], "messageId": row["message_id"],
                       "createTime": row["create_time"], "body": row["body"],
                       "typeList": row["type_list"], "ip": row["ip"]}
            result = None
            if row["result_id"] is not None:
                result = {"messageId": row["message_id"], "rawSuccess": row["raw_success"],
                          "errorReason": row["error_reason"], "runTime": row["run_time"],
                          "type": row["type"], "successList": row["success_list"],
                          "failList": row["fail_list"], "timeCost": row["time_cost"]}
            items.append({"command": command, "result": result})
        return {"items": items, "total": total, "page": page, "size": size,
                "scope": {"days": RETENTION_DAYS, "max_commands": MAX_COMMANDS, "since": cutoff}}
    finally:
        conn.close()
