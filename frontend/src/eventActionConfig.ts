export type EventAction = {
  action: 'send_text' | 'send_file' | 'create_external_group' | 'update_group';
  target: 'source' | 'fixed'; target_names: string[]; content: string;
  object_name?: string; file_url?: string; file_type?: string; extra_text?: string;
  group_name?: string; extra_members?: string[]; include_event_friend?: boolean;
  group_announcement?: string; new_group_name?: string; new_group_announcement?: string;
  group_remark?: string; show_message_history?: boolean;
};
export const actionNames: Record<string, string> = {
  send_text: '发送文字消息', send_file: '发送图片或文件',
  create_external_group: '创建群聊并拉人', update_group: '修改群信息或拉人',
};
export function defaultEventAction(kind: number, action: EventAction['action'] = 'send_text'): EventAction {
  return { action, target: [-1, -2, 103, 104].includes(kind) || (kind === 105 && action === 'update_group') ? 'fixed' : 'source',
    target_names: [], content: '', file_type: '*', group_name: '', extra_members: [],
    include_event_friend: kind === 105 && ['create_external_group', 'update_group'].includes(action) };
}
export function eventActions(config: any): EventAction[] {
  if (Array.isArray(config.actions) && config.actions.length) return config.actions;
  const kind = config.event_type || 101;
  const action = config.action || 'send_text';
  const step = { ...defaultEventAction(kind, action), ...config, action };
  // Legacy group actions always invited the event's friend to the configured group.
  if (action === 'update_group') { step.target = 'fixed'; step.target_names = config.group_name ? [config.group_name] : []; step.group_name = ''; }
  if (action === 'create_external_group' || action === 'update_group') step.include_event_friend = true;
  delete step.actions;
  return [step];
}
