const LAST_SELECTED_ROBOT_ID_KEY = 'selected_robot_id';

export function getLastSelectedRobotId(): string | undefined {
  try {
    const value = localStorage.getItem(LAST_SELECTED_ROBOT_ID_KEY);
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function setLastSelectedRobotId(robotId?: string) {
  try {
    if (robotId) {
      localStorage.setItem(LAST_SELECTED_ROBOT_ID_KEY, robotId);
    } else {
      localStorage.removeItem(LAST_SELECTED_ROBOT_ID_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function maskRobotIdForDisplay(robotId?: string): string {
  const rid = String(robotId || '').trim();
  if (!rid) return '';
  if (rid.length <= 20) return rid;
  const start = Math.max(Math.floor((rid.length - 8) / 2), 0);
  const prefix = rid.slice(0, start);
  const suffix = rid.slice(start + 8);
  return `${prefix}${"*".repeat(8)}${suffix}`;
}
