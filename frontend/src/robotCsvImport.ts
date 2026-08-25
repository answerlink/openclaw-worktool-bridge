import Papa from 'papaparse';

export type RobotCsvRow = {
  rowNumber: number;
  robotId: string;
  name: string;
  error: string;
};

const ID_HEADERS = new Set(['机器人id', 'robotid']);
const NAME_HEADERS = new Set(['机器人名称', '名称', 'robotname', 'name']);

function normalizeHeader(value: unknown) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function parseRobotCsv(text: string, maxRows = 200): RobotCsvRow[] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  if (parsed.errors.length) {
    throw new Error(`CSV 格式错误：${parsed.errors[0].message}`);
  }
  const records = parsed.data;
  if (!records.length) throw new Error('CSV 文件为空');
  const headers = records[0].map(normalizeHeader);
  const robotIdIndex = headers.findIndex((header) => ID_HEADERS.has(header));
  const nameIndex = headers.findIndex((header) => NAME_HEADERS.has(header));
  if (robotIdIndex < 0 || nameIndex < 0) {
    throw new Error('CSV 表头必须包含“机器人ID”和“机器人名称”');
  }

  const seen = new Set<string>();
  const rows: RobotCsvRow[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const robotId = String(records[index][robotIdIndex] ?? '').trim();
    const name = String(records[index][nameIndex] ?? '').trim() || '机器人';
    if (!robotId && records[index].every((value) => !String(value ?? '').trim())) continue;
    let error = '';
    if (!robotId) error = '机器人 ID 不能为空';
    else if (robotId.length > 128) error = '机器人 ID 不能超过 128 个字符';
    else if (name.length > 255) error = '机器人名称不能超过 255 个字符';
    else if (seen.has(robotId)) error = '机器人 ID 重复';
    if (robotId) seen.add(robotId);
    rows.push({ rowNumber: index + 1, robotId, name, error });
  }
  if (!rows.length) throw new Error('CSV 中没有可导入的机器人');
  if (rows.length > maxRows) throw new Error(`单次最多导入 ${maxRows} 个机器人`);
  return rows;
}

export function createRobotCsvTemplate() {
  return '\uFEFF机器人ID,机器人名称\r\n';
}
