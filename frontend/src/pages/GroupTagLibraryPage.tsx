import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Robot } from '../types';
import { getLastSelectedRobotId, maskRobotIdForDisplay, setLastSelectedRobotId } from '../robotSelection';

interface GroupTagRow {
  id: number;
  name: string;
  item_count: number;
  created_at: string;
  updated_at: string;
}

interface GroupTagItemRow {
  id: number;
  target_type: 'group';
  match_type: 'exact' | 'regex';
  value: string;
  created_at: string;
  updated_at: string;
}

export default function GroupTagLibraryPage() {
  const [tags, setTags] = useState<GroupTagRow[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);

  const [items, setItems] = useState<GroupTagItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsPageSize, setItemsPageSize] = useState(50);

  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<GroupTagRow | null>(null);
  const [tagSaving, setTagSaving] = useState(false);
  const [tagForm] = Form.useForm();

  const [addMode, setAddMode] = useState<'exact' | 'regex'>('exact');
  const [entryValues, setEntryValues] = useState<string[]>([]);
  const [addingItems, setAddingItems] = useState(false);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [sourceRobotId, setSourceRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [tagKeyword, setTagKeyword] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searchingSuggestions, setSearchingSuggestions] = useState(false);
  const suggestTimerRef = useRef<number | null>(null);

  const selectedTag = useMemo(() => tags.find((x) => x.id === selectedTagId) || null, [tags, selectedTagId]);
  const robotOptions = useMemo(
    () => robots.map((r) => ({ label: r.name ? `${r.name} (${maskRobotIdForDisplay(r.robot_id)})` : maskRobotIdForDisplay(r.robot_id), value: r.robot_id })),
    [robots]
  );

  const loadTags = async () => {
    const rid = (sourceRobotId || '').trim();
    if (!rid) {
      setTags([]);
      setSelectedTagId(null);
      setItems([]);
      setItemsTotal(0);
      return;
    }
    setTagsLoading(true);
    try {
      const res = await api.listGroupTags(rid, tagKeyword.trim() || undefined);
      const rows = (res?.items || []) as GroupTagRow[];
      setTags(rows);
      if (!rows.length) {
        setSelectedTagId(null);
      } else if (!selectedTagId || !rows.some((x) => x.id === selectedTagId)) {
        setSelectedTagId(rows[0].id);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载标签失败');
      setTags([]);
      setSelectedTagId(null);
    } finally {
      setTagsLoading(false);
    }
  };

  const loadItems = async (tagId: number, page = itemsPage, pageSize = itemsPageSize) => {
    const rid = (sourceRobotId || '').trim();
    if (!rid) {
      setItems([]);
      setItemsTotal(0);
      return;
    }
    setItemsLoading(true);
    try {
      const res = await api.listGroupTagItems(rid, tagId, { page, page_size: pageSize });
      setItems((res?.items || []) as GroupTagItemRow[]);
      setItemsTotal(Number(res?.total || 0));
      setItemsPage(Number(res?.page || page));
      setItemsPageSize(Number(res?.page_size || pageSize));
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载标签成员失败');
      setItems([]);
      setItemsTotal(0);
    } finally {
      setItemsLoading(false);
    }
  };

  const loadRobots = async () => {
    try {
      const rows = await api.listRobots();
      setRobots(rows || []);
      if (!sourceRobotId && rows?.length) {
        setSourceRobotId(rows[0].robot_id);
      }
    } catch {
      setRobots([]);
    }
  };

  const loadSuggestions = async (keyword: string) => {
    const rid = (sourceRobotId || '').trim();
    if (!rid) {
      setSuggestions([]);
      return;
    }
    setSearchingSuggestions(true);
    try {
      const res = await api.suggestGroupNames({ robot_id: rid, keyword: keyword || undefined, limit: 20 });
      setSuggestions((res?.items || []).map((x: any) => String(x || '')).filter(Boolean));
    } catch {
      setSuggestions([]);
    } finally {
      setSearchingSuggestions(false);
    }
  };

  const onSearchSuggestions = (val: string) => {
    if (suggestTimerRef.current) {
      window.clearTimeout(suggestTimerRef.current);
    }
    suggestTimerRef.current = window.setTimeout(() => {
      void loadSuggestions(val.trim());
    }, 280);
  };

  useEffect(() => {
    void loadRobots();
    return () => {
      if (suggestTimerRef.current) {
        window.clearTimeout(suggestTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSelectedTagId(null);
    setItems([]);
    setItemsTotal(0);
    setTagKeyword('');
    void loadTags();
  }, [sourceRobotId]);

  useEffect(() => {
    if (!selectedTagId) {
      setItems([]);
      setItemsTotal(0);
      return;
    }
    void loadItems(selectedTagId, 1, itemsPageSize);
  }, [selectedTagId]);

  useEffect(() => {
    setLastSelectedRobotId(sourceRobotId);
  }, [sourceRobotId]);

  const openCreateTag = () => {
    setEditingTag(null);
    tagForm.resetFields();
    tagForm.setFieldsValue({ name: '' });
    setTagModalOpen(true);
  };

  const openEditTag = (row: GroupTagRow) => {
    setEditingTag(row);
    tagForm.setFieldsValue({ name: row.name });
    setTagModalOpen(true);
  };

  const submitTag = async () => {
    const values = await tagForm.validateFields();
    const name = String(values?.name || '').trim();
    if (!name) {
      message.warning('请输入标签名');
      return;
    }
    setTagSaving(true);
    try {
      if (editingTag) {
        await api.updateGroupTag(sourceRobotId || '', editingTag.id, { name });
        message.success('标签已更新');
      } else {
        await api.createGroupTag(sourceRobotId || '', { name });
        message.success('标签已创建');
      }
      setTagModalOpen(false);
      await loadTags();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存标签失败');
    } finally {
      setTagSaving(false);
    }
  };

  const removeTag = async (row: GroupTagRow) => {
    try {
      await api.deleteGroupTag(sourceRobotId || '', row.id);
      message.success('标签已删除');
      await loadTags();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除标签失败');
    }
  };

  const addItems = async () => {
    if (!selectedTagId) {
      message.warning('请先选择标签');
      return;
    }
    const values = (entryValues || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (!values.length) {
      message.warning('请先输入群名或规则');
      return;
    }
    setAddingItems(true);
    try {
      const res = await api.createGroupTagItems(sourceRobotId || '', selectedTagId, { match_type: addMode, values });
      message.success(`已添加 ${Number(res?.created || 0)} 条`);
      setEntryValues([]);
      await Promise.all([loadItems(selectedTagId, 1, itemsPageSize), loadTags()]);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '添加失败');
    } finally {
      setAddingItems(false);
    }
  };

  const removeItem = async (row: GroupTagItemRow) => {
    if (!selectedTagId) return;
    try {
      await api.deleteGroupTagItem(sourceRobotId || '', selectedTagId, row.id);
      message.success('已删除');
      await Promise.all([loadItems(selectedTagId, itemsPage, itemsPageSize), loadTags()]);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={(
          <Space direction="vertical" size={0}>
            <span>标签库</span>
            <Typography.Text type="secondary">标签用于维护群发范围。每个标签对应一组群名或群名规则（后续可扩展到客户对象）。</Typography.Text>
          </Space>
        )}
        extra={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadTags()}>
            刷新
          </Button>
        )}
      >
        <Space style={{ marginBottom: 12 }}>
          <Select
            style={{ width: 360 }}
            value={sourceRobotId}
            onChange={setSourceRobotId}
            placeholder="用于群名建议的机器人"
            options={robotOptions}
            showSearch
            optionFilterProp="label"
          />
        </Space>
        <Space align="start" size={16} style={{ width: '100%' }}>
          <Card
            title="标签列表"
            style={{ width: 520 }}
            extra={(
              <Space>
                <Input
                  style={{ width: 180 }}
                  value={tagKeyword}
                  onChange={(e) => setTagKeyword(e.target.value)}
                  onPressEnter={() => void loadTags()}
                  placeholder="标签名称搜索"
                />
                <Button onClick={() => void loadTags()}>查询</Button>
                <Button type="primary" onClick={openCreateTag}>新建标签</Button>
              </Space>
            )}
          >
            <Table
              rowKey="id"
              size="small"
              loading={tagsLoading}
              dataSource={tags}
              pagination={false}
              rowSelection={{
                type: 'radio',
                columnWidth: 36,
                selectedRowKeys: selectedTagId ? [selectedTagId] : [],
                onChange: (keys) => setSelectedTagId(Number(keys?.[0] || 0) || null),
              }}
              columns={[
                { title: '标签名', dataIndex: 'name', width: 150, ellipsis: true },
                { title: '群数量', dataIndex: 'item_count', width: 72 },
                {
                  title: '操作',
                  width: 112,
                  render: (_, row: GroupTagRow) => (
                    <Space size={4}>
                      <Button type="link" size="small" onClick={() => openEditTag(row)}>编辑</Button>
                      <Popconfirm title="确认删除这个标签？" onConfirm={() => void removeTag(row)}>
                        <Button type="link" size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>

          <Card
            title={selectedTag ? `标签成员：${selectedTag.name}` : '标签成员'}
            style={{ flex: 1, minWidth: 0 }}
            extra={<Tag>{selectedTag ? `共 ${selectedTag.item_count} 条` : '未选择标签'}</Tag>}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Select
                style={{ width: 220 }}
                value={addMode}
                onChange={(v) => setAddMode(v)}
                options={[
                  { label: '精准匹配（群名）', value: 'exact' },
                  { label: '模糊匹配（支持正则）', value: 'regex' },
                ]}
              />

              <Space.Compact style={{ width: '100%' }}>
                <Select
                  mode="tags"
                  style={{ width: '100%' }}
                  disabled={!selectedTagId}
                  value={entryValues}
                  onChange={(vals) => setEntryValues((vals || []).map((x) => String(x || '').trim()).filter(Boolean))}
                  onSearch={onSearchSuggestions}
                  placeholder={selectedTagId ? '输入群名后回车；也可输入规则；会实时搜索群列表建议' : '请先选择标签'}
                  options={suggestions.map((x) => ({ label: x, value: x }))}
                  notFoundContent={searchingSuggestions ? '搜索中...' : '无匹配群名，直接回车可手动添加'}
                  tokenSeparators={[',', '，', ';', '；']}
                  maxTagCount="responsive"
                />
                <Button type="primary" loading={addingItems} disabled={!selectedTagId} onClick={() => void addItems()}>
                  添加到标签
                </Button>
              </Space.Compact>

              <Table
                rowKey="id"
                size="small"
                loading={itemsLoading}
                dataSource={items}
                pagination={{
                  current: itemsPage,
                  pageSize: itemsPageSize,
                  total: itemsTotal,
                  showSizeChanger: true,
                  showTotal: (t) => `共 ${t} 条`,
                  onChange: (p, ps) => selectedTagId && void loadItems(selectedTagId, p, ps),
                }}
                columns={[
                  {
                    title: '匹配方式',
                    dataIndex: 'match_type',
                    width: 160,
                    render: (v: 'exact' | 'regex') => (v === 'exact' ? <Tag color="blue">精准匹配</Tag> : <Tag color="purple">模糊/正则</Tag>),
                  },
                  { title: '群名/规则', dataIndex: 'value', ellipsis: true },
                  {
                    title: '操作',
                    width: 100,
                    render: (_, row: GroupTagItemRow) => (
                      <Popconfirm title="确认删除该条？" onConfirm={() => void removeItem(row)}>
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    ),
                  },
                ]}
              />
            </Space>
          </Card>
        </Space>
      </Card>

      <Modal
        title={editingTag ? '编辑标签' : '新建标签'}
        open={tagModalOpen}
        onCancel={() => setTagModalOpen(false)}
        onOk={() => void submitTag()}
        confirmLoading={tagSaving}
        destroyOnHidden
      >
        <Form form={tagForm} layout="vertical">
          <Form.Item name="name" label="标签名" rules={[{ required: true, message: '请输入标签名' }]}> 
            <Input maxLength={64} placeholder="例如：华东区重点客户群" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
