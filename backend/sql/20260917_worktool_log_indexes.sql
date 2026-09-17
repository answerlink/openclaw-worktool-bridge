-- Run against the upstream WorkTool database, not the console database.
-- Check SHOW INDEX first; skip an index if its leading columns already exist.
-- Online DDL permits concurrent reads/writes; fail promptly on metadata locks.
SET SESSION lock_wait_timeout = 5;
ALTER TABLE qa_log
    ADD INDEX idx_qa_robot_start_time (robot_id, start_time),
    ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE raw_message_record
    ADD INDEX idx_raw_robot_create_time (robot_id, create_time),
    ALGORITHM=INPLACE, LOCK=NONE;
