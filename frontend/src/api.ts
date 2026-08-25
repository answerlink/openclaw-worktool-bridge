import axios from 'axios';
import { AUTH_TOKEN_STORAGE_KEY } from './constants';

const http = axios.create({
  baseURL: '/api/v1',
  timeout: 15000
});

export function getAccessToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAccessToken(token: string) {
  try {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore storage errors
  }
}

export function clearAccessToken() {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      clearAccessToken();
      if (window.location.pathname !== '/login') {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${next}`;
      }
    }
    return Promise.reject(error);
  }
);

export const api = {
  authConfig: () => http.get('/auth/config').then((r) => r.data),
  authLogin: (payload: { account: string; password: string }) => http.post('/auth/login', payload).then((r) => r.data),
  authMe: () => http.get('/auth/me').then((r) => r.data),
  authLogoutAll: () => http.post('/auth/logout-all').then((r) => r.data),
  authSendSms: (payload: { phone: string; scene: 'register' | 'reset_password' | 'login' }) =>
    http.post('/auth/sms/send', payload).then((r) => r.data),
  authRegister: (payload: { phone: string; sms_code?: string; password: string; company_name?: string }) =>
    http.post('/auth/register', payload).then((r) => r.data),
  authResetPassword: (payload: { phone: string; sms_code: string; new_password: string }) =>
    http.post('/auth/password/reset', payload).then((r) => r.data),
  authChangePassword: (payload: { current_password: string; new_password: string }) =>
    http.post('/auth/password/change', payload).then((r) => r.data),
  inboxUnreadCount: () => http.get('/inbox/unread-count').then((r) => r.data),
  inboxMessages: (params: { page?: number; page_size?: number; status?: 'all' | 'read' | 'unread' }) =>
    http.get('/inbox/messages', { params }).then((r) => r.data),
  inboxMarkRead: (deliveryId: number) => http.post(`/inbox/${deliveryId}/read`).then((r) => r.data),
  inboxReadAll: () => http.post('/inbox/read-all').then((r) => r.data),
  adminInboxMessages: (params: { page?: number; page_size?: number; status?: 'all' | 'draft' | 'published' | 'offline' }) =>
    http.get('/admin/inbox/messages', { params }).then((r) => r.data),
  adminCreateInboxMessage: (payload: any) => http.post('/admin/inbox/messages', payload).then((r) => r.data),
  adminUpdateInboxMessage: (id: number, payload: any) => http.put(`/admin/inbox/messages/${id}`, payload).then((r) => r.data),
  adminDeleteInboxMessage: (id: number) => http.delete(`/admin/inbox/messages/${id}`).then((r) => r.data),
  adminPublishInboxMessage: (id: number) => http.post(`/admin/inbox/messages/${id}/publish`).then((r) => r.data),
  adminOfflineInboxMessage: (id: number) => http.post(`/admin/inbox/messages/${id}/offline`).then((r) => r.data),
  adminIpAclBlacklistQuery: () => http.get('/admin/ip-acl/blacklist').then((r) => r.data),
  adminIpAclBlacklistAdd: (ip: string) => http.post('/admin/ip-acl/blacklist/add', null, { params: { ip } }).then((r) => r.data),
  adminIpAclBlacklistDelete: (ip: string) => http.post('/admin/ip-acl/blacklist/delete', null, { params: { ip } }).then((r) => r.data),
  adminWeworkAuthorizationList: (params?: {
    corp_id?: string;
    corp_name?: string;
    deployment_type?: 'all' | 'saas' | 'private';
    expire_status?: 'all' | 'active' | 'expired';
    enabled_status?: 'all' | 'enabled' | 'disabled';
  }) =>
    http.get('/admin/wework/authorization/list', { params }).then((r) => r.data),
  adminWeworkAuthorizationSave: (payload: {
    corpId: string;
    corpName?: string;
    agentId?: string;
    isEnabled?: boolean;
    expireTime?: string;
    remark?: string;
    deploymentType?: 'all' | 'saas' | 'private';
  }) => http.post('/admin/wework/authorization/save', payload).then((r) => r.data),
  adminWeworkAuthorizationDelete: (corpId: string) =>
    http.post('/admin/wework/authorization/delete', null, { params: { corp_id: corpId } }).then((r) => r.data),
  adminRobotMigrateWeworkToWechat: (oldRobotId: string) =>
    http.post('/admin/robot-migrate/wework-to-wechat', { old_robot_id: oldRobotId }).then((r) => r.data),
  adminRobotMigrateWechatToWework: (oldRobotId: string) =>
    http.post('/admin/robot-migrate/wechat-to-wework', { old_robot_id: oldRobotId }).then((r) => r.data),
  adminRobotMigrateWeworkToNewWework: (oldRobotId: string) =>
    http.post('/admin/robot-migrate/wework-to-new-wework', { old_robot_id: oldRobotId }).then((r) => r.data),
  adminRobotMigrateWechatToNewWechat: (oldRobotId: string) =>
    http.post('/admin/robot-migrate/wechat-to-new-wechat', { old_robot_id: oldRobotId }).then((r) => r.data),
  adminRobotRenew: (robotId: string, expireDate: string) =>
    http.post('/admin/robot-migrate/renew', { robot_id: robotId, expire_date: expireDate }).then((r) => r.data),
  adminRobotInfo: (robotId: string) =>
    http.get('/admin/robot-migrate/info', { params: { robot_id: robotId } }).then((r) => r.data),
  adminRobotDisable: (robotId: string) =>
    http.post('/admin/robot-migrate/disable', { robot_id: robotId }).then((r) => r.data),
  adminRobotMigrateLogs: (limit = 10) => http.get('/admin/robot-migrate/logs', { params: { limit } }).then((r) => r.data),
  adminPrivateLicenseGenerate: (payload: {
    machine_code: string;
    remark: string;
    expire_date: string;
    expire_epoch_ms: number;
    restrict_robot: boolean;
    robot_start?: string;
    robot_end?: string;
    robot_limit?: number;
  }) => http.post('/admin/private-license/generate', payload).then((r) => r.data),
  adminPrivateLicenseLogs: (limit = 10) => http.get('/admin/private-license/logs', { params: { limit } }).then((r) => r.data),
  adminAuditLogs: (params?: {
    module?: string;
    action_key?: string;
    target_id?: string;
    target_name?: string;
    operator_phone?: string;
    status?: 'pending' | 'success' | 'failed' | 'unknown';
    start_time?: string;
    end_time?: string;
    page?: number;
    page_size?: number;
  }) => http.get('/admin/audit-logs', { params }).then((r) => r.data),
  adminAppUpdateApps: () => http.get('/admin/app-updates/apps').then((r) => r.data),
  adminAppUpdates: (appName: string) => http.get('/admin/app-updates', { params: { app_name: appName } }).then((r) => r.data),
  adminAppUpdateUpload: (payload: { app_name: string; version_name: string; file: File }) => {
    const form = new FormData();
    form.append('file', payload.file);
    return http.post('/admin/app-updates/upload', form, {
      params: { app_name: payload.app_name, version_name: payload.version_name },
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }).then((r) => r.data);
  },
  adminAppUpdateCreate: (payload: {
    app_name: string;
    title?: string;
    update_log?: string;
    remark?: string;
    version_name: string;
    version_code?: number;
    min_version_code?: number;
    download_url: string;
    size?: string;
    enable?: boolean;
  }) => http.post('/admin/app-updates', payload).then((r) => r.data),
  adminAppUpdateEnable: (id: number) => http.post(`/admin/app-updates/${id}/enable`).then((r) => r.data),
  adminListUsers: (params: { account?: string; page?: number; page_size?: number }) =>
    http.get('/admin/users', { params }).then((r) => r.data),
  adminCreateUser: (payload: { account: string; password: string; company_name?: string }) =>
    http.post('/admin/users', payload).then((r) => r.data),
  adminUpdateUserPassword: (userId: number, payload: { new_password: string }) =>
    http.put(`/admin/users/${userId}/password`, payload).then((r) => r.data),
  adminUpdateUserStatus: (userId: number, isActive: boolean) =>
    http.put(`/admin/users/${userId}/status`, { is_active: isActive }).then((r) => r.data),
  health: () => http.get('/health').then((r) => r.data),
  getOverview: () => http.get('/dashboard/overview').then((r) => r.data),
  getTrends: (days = 7) => http.get('/dashboard/trends', { params: { days } }).then((r) => r.data),
  getWorktoolSettings: () => http.get('/settings/worktool').then((r) => r.data),
  updateWorktoolSettings: (payload: {
    worktool_api_base?: string;
    callback_public_base_url?: string;
    auto_bind_message_callback_on_create?: boolean;
  }) =>
    http.put('/settings/worktool', payload).then((r) => r.data),
  listRobots: () => http.get('/robots').then((r) => r.data.items),
  getRobot: (robotId: string) => http.get(`/robots/${robotId}`).then((r) => r.data),
  createRobot: (payload: any) => http.post('/robots', payload).then((r) => r.data),
  updateRobot: (robotId: string, payload: any) => http.put(`/robots/${robotId}`, payload).then((r) => r.data),
  deleteRobot: (robotId: string) => http.delete(`/robots/${robotId}`).then((r) => r.data),
  listProviders: (robotId?: string) => http.get('/providers', { params: robotId ? { robot_id: robotId } : {} }).then((r) => r.data.items),
  createProvider: (payload: any) => http.post('/providers', payload).then((r) => r.data),
  providerTest: (payload: any) => http.post('/providers/test', payload, { timeout: 30000 }).then((r) => r.data),
  updateProvider: (id: number, payload: any) => http.put(`/providers/${id}`, payload).then((r) => r.data),
  deleteProvider: (id: number) => http.delete(`/providers/${id}`).then((r) => r.data),
  listRules: (robotId: string, scene?: string) => http.get(`/robots/${robotId}/rules`, { params: scene ? { scene } : {} }).then((r) => r.data.items),
  createRule: (payload: any) => http.post('/rules', payload).then((r) => r.data),
  updateRule: (id: number, payload: any) => http.put(`/rules/${id}`, payload).then((r) => r.data),
  deleteRule: (id: number) => http.delete(`/rules/${id}`).then((r) => r.data),
  reorderRules: (robotId: string, scene: 'group' | 'private', ruleIds: number[]) =>
    http.put(`/robots/${robotId}/rules/reorder`, { rule_ids: ruleIds }, { params: { scene } }).then((r) => r.data),
  listForwardRules: (params?: { source_robot_id?: string }) => http.get('/forwards', { params: params || {} }).then((r) => r.data.items),
  createForwardRule: (payload: any) => http.post('/forwards', payload).then((r) => r.data),
  updateForwardRule: (id: number, payload: any) => http.put(`/forwards/${id}`, payload).then((r) => r.data),
  deleteForwardRule: (id: number) => http.delete(`/forwards/${id}`).then((r) => r.data),
  listForwardLogs: (params: { robot_id?: string; page?: number; page_size?: number }) =>
    http.get('/forwards/logs', { params }).then((r) => r.data),
  listMessageLogs: (params: any) => http.get('/logs/messages', { params }).then((r) => r.data),
  getMessageLog: (id: number) => http.get(`/logs/messages/${id}`).then((r) => r.data),
  getMessageMonitorLogs: (params: any) => http.get('/message-monitor/logs', { params }).then((r) => r.data),
  getWorktoolQaLogs: (params: any) => http.get('/worktool/qa-logs', { params }).then((r) => r.data),
  getWorktoolRawCommands: (params: { robot_id: string; page?: number; size?: number; sort?: string; message_id?: string }) =>
    http.get('/worktool/raw-commands', { params }).then((r) => r.data),
  getWorktoolRawCommandResults: (params: { robot_id: string; page?: number; size?: number; sort?: string; message_id?: string }) =>
    http.get('/worktool/raw-command-results', { params }).then((r) => r.data),
  noticeWorktoolCommandBacklog: (payload: {
    robot_id: string;
    pending_overdue_count: number;
    oldest_pending_time: string;
    newest_result_time?: string;
  }) => http.post('/worktool/command-backlog/notice', payload).then((r) => r.data),
  syncGroups: (robotId: string) => http.post('/groups/sync', null, { params: { robot_id: robotId } }).then((r) => r.data),
  listGroups: (params: { robot_id: string; keyword?: string; page?: number; page_size?: number }) =>
    http.get('/groups', { params }).then((r) => r.data),
  listGroupTags: (robotId: string, keyword?: string) =>
    http.get('/group-tags', { params: { robot_id: robotId, keyword: keyword || undefined } }).then((r) => r.data),
  createGroupTag: (robotId: string, payload: { name: string }) =>
    http.post('/group-tags', payload, { params: { robot_id: robotId } }).then((r) => r.data),
  updateGroupTag: (robotId: string, id: number, payload: { name: string }) =>
    http.put(`/group-tags/${id}`, payload, { params: { robot_id: robotId } }).then((r) => r.data),
  deleteGroupTag: (robotId: string, id: number) =>
    http.delete(`/group-tags/${id}`, { params: { robot_id: robotId } }).then((r) => r.data),
  listGroupTagItems: (robotId: string, tagId: number, params?: { page?: number; page_size?: number }) =>
    http.get(`/group-tags/${tagId}/items`, { params: { ...(params || {}), robot_id: robotId } }).then((r) => r.data),
  createGroupTagItems: (robotId: string, tagId: number, payload: { match_type: 'exact' | 'regex'; values: string[] }) =>
    http.post(`/group-tags/${tagId}/items`, payload, { params: { robot_id: robotId } }).then((r) => r.data),
  deleteGroupTagItem: (robotId: string, tagId: number, itemId: number) =>
    http.delete(`/group-tags/${tagId}/items/${itemId}`, { params: { robot_id: robotId } }).then((r) => r.data),
  suggestGroupNames: (params: { robot_id: string; keyword?: string; limit?: number }) =>
    http.get('/group-tags/group-suggestions', { params }).then((r) => r.data),
  dispatchTask: (payload: any) => http.post('/tasks/dispatch', payload, { timeout: 30000 }).then((r) => r.data),
  listScheduledTasks: (robotId: string) => http.get('/scheduled-tasks', { params: { robot_id: robotId } }).then((r) => r.data),
  createScheduledTask: (payload: any) => http.post('/scheduled-tasks', payload).then((r) => r.data),
  updateScheduledTask: (id: number, payload: any) => http.put(`/scheduled-tasks/${id}`, payload).then((r) => r.data),
  deleteScheduledTask: (id: number) => http.delete(`/scheduled-tasks/${id}`).then((r) => r.data),
  enableScheduledTask: (id: number) => http.post(`/scheduled-tasks/${id}/enable`).then((r) => r.data),
  pauseScheduledTask: (id: number) => http.post(`/scheduled-tasks/${id}/pause`).then((r) => r.data),
  runScheduledTaskNow: (id: number) => http.post(`/scheduled-tasks/${id}/run-now`).then((r) => r.data),
  listScheduledTaskRuns: (id: number, params?: { page?: number; page_size?: number }) =>
    http.get(`/scheduled-tasks/${id}/runs`, { params: params || {} }).then((r) => r.data),
  getRobotInfoDetail: (robotId: string) => http.get('/robot-info/detail', { params: { robot_id: robotId } }).then((r) => r.data),
  getRobotInfoCallbacks: (robotId: string) => http.get('/robot-info/callbacks', { params: { robot_id: robotId } }).then((r) => r.data),
  getRobotInfoOnline: (robotId: string) => http.get('/robot-info/online', { params: { robot_id: robotId } }).then((r) => r.data),
  getRobotInfoOnlineInfos: (robotId: string) => http.get('/robot-info/online-infos', { params: { robot_id: robotId } }).then((r) => r.data),
  getRobotInfoVersion: (robotId: string) => http.get('/robot-info/version', { params: { robot_id: robotId } }).then((r) => r.data),
  testRobotMessageCallback: (robotId: string, callbackUrl: string) =>
    http.post('/robot-info/message-callback/test', { robot_id: robotId, callback_url: callbackUrl }).then((r) => r.data),
  testRobotCallback2xx: (callbackUrl: string) =>
    http.post('/robot-info/callbacks/test', { callback_url: callbackUrl }).then((r) => r.data),
  bindRobotMessageCallback: (robotId: string, callbackUrl: string) =>
    http.post('/robot-info/message-callback/bind', { robot_id: robotId, callback_url: callbackUrl }).then((r) => r.data),
  bindRobotCallbackType: (robotId: string, callbackUrl: string, type: number) =>
    http.post('/robot-info/callbacks/bind', { robot_id: robotId, callback_url: callbackUrl, type }).then((r) => r.data),
  deleteRobotCallbackByType: (robotId: string, type: number, robotKey = '') =>
    http.post('/robot-info/callbacks/delete-by-type', { robot_id: robotId, type, robot_key: robotKey }).then((r) => r.data),
  troubleshootSearch: (payload: any) => http.post('/troubleshoot/search', payload).then((r) => r.data),
  queryClientLogSnippet: (messageId: string) => http.post('/admin/client-log-snippet/query', { message_id: messageId }).then((r) => r.data)
};
