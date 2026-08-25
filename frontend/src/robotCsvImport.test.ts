import { describe, expect, it } from 'vitest';
import { createRobotCsvTemplate, parseRobotCsv } from './robotCsvImport';

describe('parseRobotCsv', () => {
  it('parses Chinese headers and defaults an empty name', () => {
    expect(parseRobotCsv('\uFEFF机器人ID,机器人名称\nwt1,一号\nwt2,')).toEqual([
      { rowNumber: 2, robotId: 'wt1', name: '一号', error: '' },
      { rowNumber: 3, robotId: 'wt2', name: '机器人', error: '' },
    ]);
  });

  it('supports English aliases and quoted commas', () => {
    expect(parseRobotCsv('Robot ID,Robot Name\nwt1,"上海,一号"')[0]).toMatchObject({ robotId: 'wt1', name: '上海,一号' });
  });

  it('supports Windows line endings and escaped quotes', () => {
    expect(parseRobotCsv('机器人ID,机器人名称\r\nwt1,"上海""一号"""\r\n')[0]).toMatchObject({ robotId: 'wt1', name: '上海"一号"' });
  });

  it('marks duplicates and missing ids', () => {
    const rows = parseRobotCsv('机器人ID,机器人名称\nwt1,A\nwt1,B\n,C');
    expect(rows[1].error).toBe('机器人 ID 重复');
    expect(rows[2].error).toBe('机器人 ID 不能为空');
  });

  it('rejects missing required headers and too many rows', () => {
    expect(() => parseRobotCsv('id,name\nwt1,A')).toThrow('表头');
    expect(() => parseRobotCsv('机器人ID,机器人名称\nwt1,A\nwt2,B', 1)).toThrow('最多导入 1 个');
  });

  it('creates an Excel-friendly template', () => {
    expect(createRobotCsvTemplate()).toBe('\uFEFF机器人ID,机器人名称\r\n');
  });
});
