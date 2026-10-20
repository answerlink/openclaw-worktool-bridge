import { describe, expect, it } from 'vitest';
import { defaultEventAction, eventActions } from './eventActionConfig';
describe('event action compatibility', () => {
  it('keeps legacy message targets and content', () => {
    expect(eventActions({ event_type: 101, target: 'fixed', target_names: ['客服群'], content: '欢迎' })[0])
      .toMatchObject({ action: 'send_text', target: 'fixed', target_names: ['客服群'], content: '欢迎' });
  });
  it('keeps legacy group invitations', () => {
    expect(eventActions({ event_type: 105, action: 'update_group', group_name: '客户群', extra_members: ['客服'] })[0])
      .toMatchObject({ action: 'update_group', target: 'fixed', target_names: ['客户群'], group_name: '', include_event_friend: true, extra_members: ['客服'] });
  });
  it('keeps step order and gives offline/friend group actions fixed targets', () => {
    const actions = [defaultEventAction(105), defaultEventAction(105, 'create_external_group')];
    expect(eventActions({ actions })).toEqual(actions);
    expect(defaultEventAction(-2).target).toBe('fixed');
    expect(defaultEventAction(105, 'update_group')).toMatchObject({ target: 'fixed', include_event_friend: true });
  });
});
