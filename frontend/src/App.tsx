import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Drawer, Form, Input, Layout, Menu, Modal, Space, Spin, Typography, message } from 'antd';
import {
  DashboardOutlined,
  FileSearchOutlined,
  FileDoneOutlined,
  RobotOutlined,
  FileTextOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BellOutlined,
  BuildOutlined,
  ProfileOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuOutlined,
  NotificationOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ShareAltOutlined,
  StopOutlined,
  TeamOutlined,
  TagsOutlined
} from '@ant-design/icons';
import LoginPage from './pages/LoginPage';
import ChatbotLauncher from './components/ChatbotLauncher';
import { api, clearAccessToken, getAccessToken } from './api';
import { track, trackPage } from './analytics';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const RobotPage = lazy(() => import('./pages/RobotPage'));
const MessageLogPage = lazy(() => import('./pages/MessageLogPage'));
const AIHubPage = lazy(() => import('./pages/AIHubPage'));
const ForwardPage = lazy(() => import('./pages/ForwardPage'));
const RobotInfoPage = lazy(() => import('./pages/RobotInfoPage'));
const TroubleshootPage = lazy(() => import('./pages/TroubleshootPage'));
const ClientLogPage = lazy(() => import('./pages/ClientLogPage'));
const CommandTaskPage = lazy(() => import('./pages/CommandTaskPage'));
const GroupListPage = lazy(() => import('./pages/GroupListPage'));
const GroupTagLibraryPage = lazy(() => import('./pages/GroupTagLibraryPage'));
const TaskCenterPage = lazy(() => import('./pages/TaskCenterPage'));
const ScheduledTaskPage = lazy(() => import('./pages/ScheduledTaskPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const InboxAdminPage = lazy(() => import('./pages/InboxAdminPage'));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage'));
const IpBlacklistPage = lazy(() => import('./pages/IpBlacklistPage'));
const EnterpriseAuthorizationPage = lazy(() => import('./pages/EnterpriseAuthorizationPage'));
const PrivateLicenseAuthorizationPage = lazy(() =>
  import('./pages/EnterpriseAuthorizationPage').then((module) => ({ default: module.PrivateLicenseAuthorizationPage }))
);
const RobotMigratePage = lazy(() => import('./pages/RobotMigratePage'));
const AppManagementPage = lazy(() => import('./pages/AppManagementPage'));
const AdminAuditLogPage = lazy(() => import('./pages/AdminAuditLogPage'));
const ManualOrderPage = lazy(() => import('./pages/ManualOrderPage'));

const { Header, Sider, Content } = Layout;

function maskPhone(phone?: string) {
  const p = String(phone || '').trim();
  if (/^1\d{10}$/.test(p)) {
    return `${p.slice(0, 3)}****${p.slice(7)}`;
  }
  return p || '-';
}

function ChangePasswordButton({ block = false }: { block?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const submit = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      await api.authChangePassword({
        current_password: String(values.current_password || ''),
        new_password: String(values.new_password || ''),
      });
      message.success('密码已修改，请使用新密码重新登录');
      clearAccessToken();
      window.location.href = '/login';
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '修改密码失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button block={block} icon={<KeyOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>修改密码</Button>
      <Modal title="修改登录密码" open={open} onCancel={() => setOpen(false)} onOk={() => void submit()} confirmLoading={loading} okText="确认修改">
        <Form form={form} layout="vertical">
          <Form.Item name="current_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '密码至少8位' }]}
          >
            <Input.Password placeholder="至少8位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue('new_password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [enableTroubleshoot, setEnableTroubleshoot] = useState(false);
  const [enableAdminIpBlacklist, setEnableAdminIpBlacklist] = useState(false);
  const [enableAdminEnterpriseAuth, setEnableAdminEnterpriseAuth] = useState(false);
  const [deploymentMode, setDeploymentMode] = useState<'private' | 'saas' | ''>('');
  const [healthReady, setHealthReady] = useState(false);
  const [authReady, setAuthReady] = useState(() => location.pathname === '/login' || !getAccessToken());
  const [authed, setAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userPhone, setUserPhone] = useState('');
  const [robotInitChecked, setRobotInitChecked] = useState(false);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);

  useEffect(() => {
    const syncViewport = () => setIsMobile(window.innerWidth <= 768);
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    if (location.pathname === '/login') {
      setAuthed(false);
      setIsAdmin(false);
      setUserPhone('');
      setRobotInitChecked(false);
      setAuthReady(true);
      return;
    }
    const token = getAccessToken();
    if (!token) {
      setAuthed(false);
      setIsAdmin(false);
      setUserPhone('');
      setRobotInitChecked(false);
      setAuthReady(true);
      return;
    }
    setAuthReady(false);
    let mounted = true;
    api
      .authMe()
      .then((me) => {
        if (mounted) {
          setAuthed(true);
          setIsAdmin(Boolean(me?.is_admin));
          setUserPhone(String(me?.phone || ''));
          setAuthReady(true);
        }
      })
      .catch(() => {
        if (mounted) {
          clearAccessToken();
          setAuthed(false);
          setIsAdmin(false);
          setUserPhone('');
          setAuthReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  // Re-check authentication when entering/leaving the login page, but do not
  // restart the whole app initialization on every normal route change.
  }, [location.pathname === '/login']);

  useEffect(() => {
    if (!authed) {
      setHealthReady(false);
      return;
    }
    let mounted = true;
    setHealthReady(false);
    api
      .health()
      .then((d) => {
        if (mounted) {
          const mode = String(d?.deployment_mode || '').toLowerCase();
          setDeploymentMode(mode === 'private' || mode === 'saas' ? mode : '');
          setEnableTroubleshoot(Boolean(d?.enable_troubleshoot));
          setEnableAdminIpBlacklist(Boolean(d?.enable_admin_ip_blacklist));
          setEnableAdminEnterpriseAuth(Boolean(d?.enable_admin_enterprise_auth));
          setHealthReady(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setDeploymentMode('');
          setEnableTroubleshoot(false);
          setEnableAdminIpBlacklist(false);
          setEnableAdminEnterpriseAuth(false);
          setHealthReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [authed]);

  const isSaasDeployment = deploymentMode === 'saas';

  useEffect(() => {
    if (!authed) return;
    let canceled = false;
    const loadUnread = async () => {
      try {
        const res = await api.inboxUnreadCount();
        if (!canceled) {
          setInboxUnreadCount(Number(res?.count || 0));
        }
      } catch {
        if (!canceled) {
          setInboxUnreadCount(0);
        }
      }
    };
    void loadUnread();
    const timer = window.setInterval(() => {
      void loadUnread();
    }, 60000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [authed, location.pathname]);

  useEffect(() => {
    const onUnreadUpdate = (ev: Event) => {
      const customEv = ev as CustomEvent<{ count?: number }>;
      const next = Number(customEv?.detail?.count ?? 0);
      setInboxUnreadCount(Number.isFinite(next) ? next : 0);
    };
    window.addEventListener('inbox-unread-updated', onUnreadUpdate as EventListener);
    return () => {
      window.removeEventListener('inbox-unread-updated', onUnreadUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!authed || location.pathname === '/login') return;
    const startedAt = Date.now();
    trackPage(`${location.pathname}${location.search}`);
    return () => {
      track('page_leave', {
        path: `${location.pathname}${location.search}`,
        duration_seconds: Math.round((Date.now() - startedAt) / 1000),
      });
    };
  }, [authed, location.pathname, location.search]);

  useEffect(() => {
    if (!authed || location.pathname === '/login' || robotInitChecked) {
      return;
    }
    let mounted = true;
    api
      .listRobots()
      .then((robots) => {
        if (!mounted) return;
        setRobotInitChecked(true);
        if ((robots || []).length === 0 && location.pathname !== '/robots') {
          navigate('/robots', { replace: true });
        }
      })
      .catch(() => {
        if (mounted) {
          setRobotInitChecked(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [authed, location.pathname, navigate, robotInitChecked]);

  const items = useMemo(() => {
    const baseItems: any[] = [
      { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">控制台</Link> },
      { key: '/robot-info', icon: <InfoCircleOutlined />, label: <Link to="/robot-info">机器人信息</Link> },
      { key: '/robots', icon: <RobotOutlined />, label: <Link to="/robots">机器人配置</Link> },
      { key: '/logs', icon: <FileTextOutlined />, label: <Link to="/logs">消息监控</Link> },
      { key: '/group-tags', icon: <TagsOutlined />, label: <Link to="/group-tags">标签库</Link> },
      { key: '/groups', icon: <TeamOutlined />, label: <Link to="/groups">群列表</Link> },
      { key: '/task-center', icon: <ProfileOutlined />, label: <Link to="/task-center">指令任务下发</Link> },
      { key: '/scheduled-tasks', icon: <ProfileOutlined />, label: <Link to="/scheduled-tasks">定时任务</Link> },
      { key: '/command-tasks', icon: <ProfileOutlined />, label: <Link to="/command-tasks">指令任务查询</Link> },
      { key: '/forward', icon: <ShareAltOutlined />, label: <Link to="/forward">消息转发</Link> },
      { key: '/providers', icon: <ApiOutlined />, label: <Link to="/providers">AI回复引擎</Link> }
    ];

    if (isAdmin) {
      const adminItems: any[] = [
        { key: '/users', icon: <TeamOutlined />, label: <Link to="/users">用户管理</Link> }
      ];
      if (isSaasDeployment) {
        if (enableTroubleshoot) {
          adminItems.push({ key: '/troubleshoot', icon: <SearchOutlined />, label: <Link to="/troubleshoot">机器人排查</Link> });
          adminItems.push({ key: '/client-logs', icon: <FileSearchOutlined />, label: <Link to="/client-logs">客户端日志</Link> });
        }
        adminItems.push({ key: '/inbox-admin', icon: <NotificationOutlined />, label: <Link to="/inbox-admin">站内信配置</Link> });
        adminItems.push({ key: '/robot-migrate', icon: <BuildOutlined />, label: <Link to="/robot-migrate">机器人更换续期</Link> });
        adminItems.push({ key: '/app-management', icon: <AppstoreOutlined />, label: <Link to="/app-management">App管理</Link> });
        adminItems.push({ key: '/manual-orders', icon: <FileDoneOutlined />, label: <Link to="/manual-orders">线下订单登记</Link> });
        adminItems.push({ key: '/admin-audit-logs', icon: <FileSearchOutlined />, label: <Link to="/admin-audit-logs">管理员审计日志</Link> });
        if (enableAdminIpBlacklist) {
          adminItems.push({ key: '/ip-blacklist', icon: <StopOutlined />, label: <Link to="/ip-blacklist">黑名单管理</Link> });
        }
        if (enableAdminEnterpriseAuth) {
          adminItems.push({ key: '/enterprise-authorization', icon: <BuildOutlined />, label: <Link to="/enterprise-authorization">企业定制开通</Link> });
          adminItems.push({ key: '/private-license', icon: <SafetyCertificateOutlined />, label: <Link to="/private-license">私有化授权</Link> });
        }
      }

      baseItems.push({ type: 'divider' });
      baseItems.push(...adminItems);
    }
    return baseItems;
  }, [enableTroubleshoot, isAdmin, isSaasDeployment, enableAdminIpBlacklist, enableAdminEnterpriseAuth]);

  const handleLogout = async () => {
    try {
      await api.authLogoutAll();
    } catch {
      // Ignore remote logout errors and always clear the local session.
    }
    clearAccessToken();
    window.location.href = '/login';
  };

  if (!authReady) {
    return (
      <div className="route-loading" role="status" aria-label="正在验证登录状态">
        <Space direction="vertical" align="center" size={12}>
          <Spin size="large" />
          <Typography.Text type="secondary">正在验证登录状态…</Typography.Text>
        </Space>
      </div>
    );
  }

  if (!authed && location.pathname !== '/login') {
    if (getAccessToken()) {
      return (
        <div className="route-loading" role="status" aria-label="正在验证登录状态">
          <Space direction="vertical" align="center" size={12}>
            <Spin size="large" />
            <Typography.Text type="secondary">正在验证登录状态…</Typography.Text>
          </Space>
        </div>
      );
    }
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  if (authed && !healthReady) {
    return (
      <div className="route-loading" role="status" aria-label="正在加载平台配置">
        <Space direction="vertical" align="center" size={12}>
          <Spin size="large" />
          <Typography.Text type="secondary">正在加载平台配置…</Typography.Text>
        </Space>
      </div>
    );
  }

  if (location.pathname === '/login') {
    return <LoginPage />;
  }

  if (location.pathname === '/') {
    return <Navigate to="/dashboard" replace />;
  }

  const pageRoutes = (
    <Suspense
      fallback={(
        <div className="route-loading" role="status" aria-label="页面加载中">
          <Spin size="large" />
        </div>
      )}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/robot-info" element={<RobotInfoPage />} />
        <Route path="/robots" element={<RobotPage />} />
        <Route path="/logs" element={<MessageLogPage />} />
        <Route path="/group-tags" element={<GroupTagLibraryPage />} />
        <Route path="/task-center" element={<TaskCenterPage />} />
        <Route path="/scheduled-tasks" element={<ScheduledTaskPage />} />
        <Route path="/groups" element={<GroupListPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/command-tasks" element={<CommandTaskPage />} />
        <Route path="/forward" element={<ForwardPage />} />
        <Route path="/providers" element={<AIHubPage />} />
        {enableTroubleshoot && isAdmin && isSaasDeployment ? <Route path="/troubleshoot" element={<TroubleshootPage />} /> : <Route path="/troubleshoot" element={<Navigate to="/dashboard" replace />} />}
        {enableTroubleshoot && isAdmin && isSaasDeployment ? <Route path="/client-logs" element={<ClientLogPage />} /> : <Route path="/client-logs" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin ? <Route path="/users" element={<UserManagementPage />} /> : <Route path="/users" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin && isSaasDeployment ? <Route path="/inbox-admin" element={<InboxAdminPage />} /> : <Route path="/inbox-admin" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin && isSaasDeployment ? <Route path="/robot-migrate" element={<RobotMigratePage />} /> : <Route path="/robot-migrate" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin && isSaasDeployment ? <Route path="/app-management" element={<AppManagementPage />} /> : <Route path="/app-management" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin && isSaasDeployment ? <Route path="/manual-orders" element={<ManualOrderPage />} /> : <Route path="/manual-orders" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin && isSaasDeployment ? <Route path="/admin-audit-logs" element={<AdminAuditLogPage />} /> : <Route path="/admin-audit-logs" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin && isSaasDeployment && enableAdminIpBlacklist ? <Route path="/ip-blacklist" element={<IpBlacklistPage />} /> : <Route path="/ip-blacklist" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin && isSaasDeployment && enableAdminEnterpriseAuth ? <Route path="/enterprise-authorization" element={<EnterpriseAuthorizationPage />} /> : <Route path="/enterprise-authorization" element={<Navigate to="/dashboard" replace />} />}
        {isAdmin && isSaasDeployment && enableAdminEnterpriseAuth ? <Route path="/private-license" element={<PrivateLicenseAuthorizationPage />} /> : <Route path="/private-license" element={<Navigate to="/dashboard" replace />} />}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );

  if (isMobile) {
    return (
      <Layout className="app-mobile-shell">
        <Header className="mobile-topbar">
          <Button type="text" icon={<MenuOutlined />} aria-label="打开导航" onClick={() => setMobileNavOpen(true)} />
          <Typography.Text strong className="mobile-topbar-title">机器人管理系统</Typography.Text>
          <Badge count={inboxUnreadCount} overflowCount={99} size="small">
            <Button type="text" icon={<BellOutlined />} aria-label="站内信" onClick={() => navigate('/inbox')} />
          </Badge>
        </Header>
        <Drawer
          title="WorkTool Console"
          placement="left"
          width={280}
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          styles={{ body: { display: 'flex', flexDirection: 'column', padding: 12 } }}
        >
          <Menu mode="inline" selectedKeys={[location.pathname]} items={items} onClick={() => setMobileNavOpen(false)} />
          <div className="mobile-drawer-footer">
            <Button block icon={<BellOutlined />} onClick={() => { setMobileNavOpen(false); navigate('/inbox'); }}>
              站内信
            </Button>
            <Button block href="/docs/" target="_blank" rel="noreferrer">使用文档</Button>
            <Button block href="https://worktool.apifox.cn/" target="_blank" rel="noreferrer">API文档</Button>
            <Button block href="https://github.com/answerlink/openclaw-worktool-bridge" target="_blank" rel="noreferrer">开源地址</Button>
            <Typography.Text type="secondary">账号：{maskPhone(userPhone)}</Typography.Text>
            <ChangePasswordButton block />
            <Button block icon={<LogoutOutlined />} onClick={() => void handleLogout()}>退出登录</Button>
          </div>
        </Drawer>
        <Content className="mobile-content-wrap">{pageRoutes}</Content>
        <ChatbotLauncher />
      </Layout>
    );
  }

  return (
    <Layout className="app-shell" style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider width={228} className="app-sider">
        <div className="app-sider-inner">
          <div className="app-sider-main">
            <div className="brand">WorkTool Console</div>
            <div className="app-menu-wrap">
              <Menu className="app-menu" theme="light" mode="inline" selectedKeys={[location.pathname]} items={items} />
            </div>
          </div>
          <div className="app-sider-footer">
            <Button
              type="default"
              icon={<BellOutlined />}
              block
              onClick={() => navigate('/inbox')}
            >
              <Badge count={inboxUnreadCount} overflowCount={99} offset={[10, 2]}>
                <span>站内信</span>
              </Badge>
            </Button>
            <Typography.Text type="secondary">账号：{maskPhone(userPhone)}</Typography.Text>
          </div>
        </div>
      </Sider>
      <Layout className="app-main-layout" style={{ minWidth: 0 }}>
        <Header className="topbar">
          <div className="topbar-inner">
            <Typography.Title className="topbar-title" level={4} style={{ margin: 0, color: '#304047' }}>
              机器人管理系统
            </Typography.Title>
            <Space className="topbar-actions" wrap>
              <Button href="/docs/" target="_blank" rel="noreferrer">
                使用文档
              </Button>
              <Button href="https://worktool.apifox.cn/" target="_blank" rel="noreferrer">
                API文档
              </Button>
              <Button href="https://github.com/answerlink/openclaw-worktool-bridge" target="_blank" rel="noreferrer">
                开源地址
              </Button>
              <ChangePasswordButton />
              <Button
                onClick={() => void handleLogout()}
              >
                退出登录
              </Button>
            </Space>
          </div>
        </Header>
        <Content className="content-wrap">
          {pageRoutes}
        </Content>
        <ChatbotLauncher />
      </Layout>
    </Layout>
  );
}
