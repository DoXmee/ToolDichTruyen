import React, { useState, useMemo } from 'react';
import type {
  CharacterRelation,
  EntityCategory,
  StoryEntity,
  StoryMemory,
} from '../../../shared/types';
import { Icon } from '../../components/Icon';

interface StoryMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  memory: StoryMemory | null;
  onSave: (updated: StoryMemory) => Promise<void>;
  storyTitle?: string;
}

export const StoryMemoryModal: React.FC<StoryMemoryModalProps> = ({
  isOpen,
  onClose,
  memory,
  onSave,
  storyTitle,
}) => {
  if (!isOpen) return null;

  const currentMemory: StoryMemory = memory ?? {
    version: 1,
    storyTitle: storyTitle || 'Bộ truyện hiện tại',
    entities: [],
    relations: [],
    recentDialogues: [],
    customRules: [],
    updatedAt: new Date().toISOString(),
  };

  const [activeTab, setActiveTab] = useState<'characters' | 'locations' | 'terms' | 'rules'>('characters');
  const [searchTerm, setSearchTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // Form states for Character
  const [newCharHan, setNewCharHan] = useState('');
  const [newCharVn, setNewCharVn] = useState('');
  const [newCharGender, setNewCharGender] = useState<'male' | 'female' | 'unknown'>('male');
  const [newCharRole, setNewCharRole] = useState('');

  // Form states for Relation
  const [newRelSrc, setNewRelSrc] = useState('');
  const [newRelTgt, setNewRelTgt] = useState('');
  const [newRelType, setNewRelType] = useState('Bằng hữu');
  const [newRelPronoun, setNewRelPronoun] = useState('Huynh - Đệ');
  const [newRelTone, setNewRelTone] = useState('');

  // Form states for Location / Terms
  const [newTermHan, setNewTermHan] = useState('');
  const [newTermVn, setNewTermVn] = useState('');
  const [newTermCategory, setNewTermCategory] = useState<EntityCategory>('location');

  // Form states for Rule
  const [newRuleText, setNewRuleText] = useState('');

  // Filtered lists
  const filteredEntities = useMemo(() => {
    const list = currentMemory.entities || [];
    if (!searchTerm.trim()) return list;
    const q = searchTerm.toLowerCase();
    return list.filter(
      (e) =>
        e.chinese.toLowerCase().includes(q) ||
        e.vietnamese.toLowerCase().includes(q) ||
        (e.role && e.role.toLowerCase().includes(q)),
    );
  }, [currentMemory.entities, searchTerm]);

  const characters = useMemo(
    () => filteredEntities.filter((e) => e.category === 'character'),
    [filteredEntities],
  );

  const locations = useMemo(
    () => filteredEntities.filter((e) => e.category === 'location' || e.category === 'faction'),
    [filteredEntities],
  );

  const terms = useMemo(
    () => filteredEntities.filter((e) => e.category === 'term' || e.category === 'cultivation'),
    [filteredEntities],
  );

  const showTemporaryNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  const handleAddCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCharHan.trim() || !newCharVn.trim()) return;

    setBusy(true);
    try {
      const existing = currentMemory.entities.filter((item) => item.chinese !== newCharHan.trim());
      const newEntity: StoryEntity = {
        id: `char-${Date.now()}`,
        category: 'character',
        chinese: newCharHan.trim(),
        vietnamese: newCharVn.trim(),
        gender: newCharGender,
        role: newCharRole.trim() || undefined,
      };

      const updated: StoryMemory = {
        ...currentMemory,
        entities: [...existing, newEntity],
        updatedAt: new Date().toISOString(),
      };

      await onSave(updated);
      setNewCharHan('');
      setNewCharVn('');
      setNewCharRole('');
      showTemporaryNotice(`Đã thêm nhân vật: ${newEntity.vietnamese}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddRelation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRelSrc.trim() || !newRelTgt.trim()) return;

    setBusy(true);
    try {
      const newRel: CharacterRelation = {
        id: `rel-${Date.now()}`,
        sourceCharacter: newRelSrc.trim(),
        targetCharacter: newRelTgt.trim(),
        relationType: newRelType.trim() || 'Bằng hữu',
        pronounSample: newRelPronoun.trim() || 'Ngươi - Ta',
        toneInstruction: newRelTone.trim() || undefined,
      };

      const key = `${newRel.sourceCharacter}_x_${newRel.targetCharacter}`;
      const existing = (currentMemory.relations || []).filter(
        (r) => `${r.sourceCharacter}_x_${r.targetCharacter}` !== key,
      );

      const updated: StoryMemory = {
        ...currentMemory,
        relations: [...existing, newRel],
        updatedAt: new Date().toISOString(),
      };

      await onSave(updated);
      setNewRelSrc('');
      setNewRelTgt('');
      setNewRelPronoun('');
      setNewRelTone('');
      showTemporaryNotice(`Đã lưu quan hệ: ${newRel.sourceCharacter} x ${newRel.targetCharacter}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTermHan.trim() || !newTermVn.trim()) return;

    setBusy(true);
    try {
      const existing = currentMemory.entities.filter((item) => item.chinese !== newTermHan.trim());
      const newEntity: StoryEntity = {
        id: `term-${Date.now()}`,
        category: newTermCategory,
        chinese: newTermHan.trim(),
        vietnamese: newTermVn.trim(),
      };

      const updated: StoryMemory = {
        ...currentMemory,
        entities: [...existing, newEntity],
        updatedAt: new Date().toISOString(),
      };

      await onSave(updated);
      setNewTermHan('');
      setNewTermVn('');
      showTemporaryNotice(`Đã thêm: ${newEntity.vietnamese}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleText.trim()) return;

    setBusy(true);
    try {
      const updated: StoryMemory = {
        ...currentMemory,
        customRules: [...(currentMemory.customRules || []), newRuleText.trim()],
        updatedAt: new Date().toISOString(),
      };

      await onSave(updated);
      setNewRuleText('');
      showTemporaryNotice('Đã thêm quy tắc dịch mới');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEntity = async (chinese: string) => {
    setBusy(true);
    try {
      const updated: StoryMemory = {
        ...currentMemory,
        entities: currentMemory.entities.filter((e) => e.chinese !== chinese),
        updatedAt: new Date().toISOString(),
      };
      await onSave(updated);
      showTemporaryNotice('Đã xóa mục đã chọn');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRelation = async (id: string) => {
    setBusy(true);
    try {
      const updated: StoryMemory = {
        ...currentMemory,
        relations: (currentMemory.relations || []).filter((r) => r.id !== id),
        updatedAt: new Date().toISOString(),
      };
      await onSave(updated);
      showTemporaryNotice('Đã xóa quy ước quan hệ');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRule = async (index: number) => {
    setBusy(true);
    try {
      const nextRules = [...(currentMemory.customRules || [])];
      nextRules.splice(index, 1);
      const updated: StoryMemory = {
        ...currentMemory,
        customRules: nextRules,
        updatedAt: new Date().toISOString(),
      };
      await onSave(updated);
      showTemporaryNotice('Đã xóa quy tắc');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAllMemory = async () => {
    if (
      !window.confirm(
        'Bạn có chắc chắn muốn xóa sạch toàn bộ thực thể và quy ước trong bộ nhớ truyện này? Dữ liệu trí nhớ sẽ được làm mới từ đầu.',
      )
    )
      return;
    setBusy(true);
    try {
      const empty: StoryMemory = {
        version: 1,
        storyTitle: storyTitle || '',
        entities: [],
        relations: [],
        recentDialogues: [],
        customRules: [],
        updatedAt: new Date().toISOString(),
      };
      await onSave(empty);
      showTemporaryNotice('Đã dọn sạch toàn bộ bộ nhớ truyện.');
    } catch {
      showTemporaryNotice('Không thể xóa bộ nhớ.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(currentMemory, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `memory-${storyTitle || 'story'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && typeof parsed === 'object') {
          setBusy(true);
          const merged: StoryMemory = {
            ...currentMemory,
            entities: [...(currentMemory.entities || []), ...(parsed.entities || [])],
            relations: [...(currentMemory.relations || []), ...(parsed.relations || [])],
            customRules: [...(currentMemory.customRules || []), ...(parsed.customRules || [])],
            updatedAt: new Date().toISOString(),
          };
          await onSave(merged);
          showTemporaryNotice('Đã nạp file từ điển thành công!');
        }
      } catch {
        alert('File JSON không hợp lệ.');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="memory-modal-overlay" role="dialog" aria-modal="true" aria-label="Trí nhớ truyện & Thuật ngữ">
      <div className="memory-modal">
        {/* Header */}
        <div className="memory-modal__head">
          <div className="memory-modal__title-group">
            <span className="memory-modal__badge">
              <Icon name="sparkles" /> Living Memory
            </span>
            <h2>Trí nhớ truyện & Thuật ngữ</h2>
            <p>
              Khóa cứng tên riêng, địa danh và điều phối xưng hô linh hoạt theo tâm lý xuyên suốt các tài khoản và đoạn chat.
            </p>
          </div>
          <button className="memory-modal__close-btn" onClick={onClose} aria-label="Đóng" type="button">
            ×
          </button>
        </div>

        {/* Global Toolbar */}
        <div className="memory-modal__toolbar">
          <div className="memory-modal__search">
            <Icon name="search" />
            <input
              placeholder="Tìm kiếm nhân vật, địa danh, thuật ngữ..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && <button onClick={() => setSearchTerm('')} type="button">×</button>}
          </div>

          <div className="memory-modal__io-actions">
            <button className="button button--secondary button--tiny" onClick={handleExportJson} type="button">
              <Icon name="save" /> Xuất JSON
            </button>
            <label className="button button--secondary button--tiny memory-modal__file-label">
              <Icon name="link" /> Nhập JSON
              <input type="file" accept=".json" onChange={handleImportJson} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="memory-modal__nav" role="tablist">
          <button
            className={`memory-modal__tab ${activeTab === 'characters' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('characters')}
            type="button"
          >
            Nhân vật & Xưng hô ({currentMemory.entities.filter((e) => e.category === 'character').length})
          </button>
          <button
            className={`memory-modal__tab ${activeTab === 'locations' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('locations')}
            type="button"
          >
            Địa danh & Thế lực ({currentMemory.entities.filter((e) => e.category === 'location' || e.category === 'faction').length})
          </button>
          <button
            className={`memory-modal__tab ${activeTab === 'terms' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('terms')}
            type="button"
          >
            Thuật ngữ & Cảnh giới ({currentMemory.entities.filter((e) => e.category === 'term' || e.category === 'cultivation').length})
          </button>
          <button
            className={`memory-modal__tab ${activeTab === 'rules' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('rules')}
            type="button"
          >
            Quy tắc & Đối thoại mẫu ({(currentMemory.customRules || []).length})
          </button>
        </div>

        {notice && <div className="memory-modal__notice">{notice}</div>}

        {/* Tab Content */}
        <div className="memory-modal__body">
          {activeTab === 'characters' && (
            <div className="memory-tab-panel">
              {/* Add Character Form */}
              <form className="memory-form" onSubmit={handleAddCharacter}>
                <span className="memory-form__title">Thêm nhân vật mới</span>
                <div className="memory-form__fields">
                  <input
                    placeholder="Tên Hán (ví dụ: 萧炎)"
                    value={newCharHan}
                    onChange={(e) => setNewCharHan(e.target.value)}
                    required
                  />
                  <input
                    placeholder="Tên dịch Việt (ví dụ: Tiêu Viêm)"
                    value={newCharVn}
                    onChange={(e) => setNewCharVn(e.target.value)}
                    required
                  />
                  <select
                    value={newCharGender}
                    onChange={(e) => setNewCharGender(e.target.value as any)}
                  >
                    <option value="male">Nam</option>
                    <option value="female">Nữ</option>
                    <option value="unknown">Chưa rõ</option>
                  </select>
                  <input
                    placeholder="Vai trò / Thân phận (ví dụ: Nhân vật chính)"
                    value={newCharRole}
                    onChange={(e) => setNewCharRole(e.target.value)}
                  />
                  <button className="button button--primary" disabled={busy} type="submit">
                    + Thêm
                  </button>
                </div>
              </form>

              {/* Character List */}
              <div className="memory-table-wrap">
                <table className="memory-table">
                  <thead>
                    <tr>
                      <th>Tên chữ Hán</th>
                      <th>Bản dịch tiếng Việt</th>
                      <th>Giới tính</th>
                      <th>Thân phận</th>
                      <th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {characters.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="memory-table__empty">
                          Chưa có nhân vật nào được lưu. Hãy thêm nhân vật hoặc để tool tự học qua quá trình dịch.
                        </td>
                      </tr>
                    ) : (
                      characters.map((char) => (
                        <tr key={char.chinese}>
                          <td><b>{char.chinese}</b></td>
                          <td><span className="memory-tag memory-tag--name">{char.vietnamese}</span></td>
                          <td>{char.gender === 'female' ? 'Nữ' : char.gender === 'male' ? 'Nam' : 'Chưa rõ'}</td>
                          <td>{char.role || '—'}</td>
                          <td>
                            <button
                              className="button button--ghost button--tiny"
                              onClick={() => handleDeleteEntity(char.chinese)}
                              type="button"
                              aria-label="Xóa nhân vật"
                            >
                              <Icon name="trash" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Relations Section */}
              <div className="memory-subheading">
                <h4>Quan hệ xưng hô linh hoạt theo cảm xúc</h4>
                <p>Điều hướng cách xưng hô giữa hai nhân vật kèm chỉ dẫn cảm xúc khi cãi vã, đối đầu hoặc tình cảm.</p>
              </div>

              <form className="memory-form" onSubmit={handleAddRelation}>
                <div className="memory-form__fields">
                  <input
                    placeholder="Nhân vật 1 (ví dụ: Tiêu Viêm)"
                    value={newRelSrc}
                    onChange={(e) => setNewRelSrc(e.target.value)}
                    required
                  />
                  <input
                    placeholder="Nhân vật 2 (ví dụ: Dược Lão)"
                    value={newRelTgt}
                    onChange={(e) => setNewRelTgt(e.target.value)}
                    required
                  />
                  <input
                    placeholder="Quan hệ (Sư đồ, Phu thê...)"
                    value={newRelType}
                    onChange={(e) => setNewRelType(e.target.value)}
                  />
                  <input
                    placeholder="Xưng hô mẫu (Sư phụ - Đồ nhi / Con)"
                    value={newRelPronoun}
                    onChange={(e) => setNewRelPronoun(e.target.value)}
                    required
                  />
                  <input
                    placeholder="Lưu ý tâm lý (ví dụ: Khi giận dữ xưng ngươi - ta)"
                    value={newRelTone}
                    onChange={(e) => setNewRelTone(e.target.value)}
                  />
                  <button className="button button--primary" disabled={busy} type="submit">
                    + Thêm quan hệ
                  </button>
                </div>
              </form>

              <div className="memory-table-wrap">
                <table className="memory-table">
                  <thead>
                    <tr>
                      <th>Nhân vật A x B</th>
                      <th>Mối quan hệ</th>
                      <th>Xưng hô chuẩn</th>
                      <th>Lưu ý tâm lý / ngữ cảnh</th>
                      <th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(currentMemory.relations || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="memory-table__empty">
                          Chưa có quy ước quan hệ nào. Thêm quy ước để AI xưng hô tự nhiên và giữ đúng vai vế.
                        </td>
                      </tr>
                    ) : (
                      currentMemory.relations.map((rel) => (
                        <tr key={rel.id}>
                          <td><b>{rel.sourceCharacter}</b> x <b>{rel.targetCharacter}</b></td>
                          <td><span className="memory-tag memory-tag--relation">{rel.relationType}</span></td>
                          <td><span className="memory-tag memory-tag--pronoun">{rel.pronounSample}</span></td>
                          <td className="memory-cell--muted">{rel.toneInstruction || 'Linh hoạt theo bối cảnh'}</td>
                          <td>
                            <button
                              className="button button--ghost button--tiny"
                              onClick={() => handleDeleteRelation(rel.id)}
                              type="button"
                              aria-label="Xóa quan hệ"
                            >
                              <Icon name="trash" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'locations' && (
            <div className="memory-tab-panel">
              <form className="memory-form" onSubmit={handleAddTerm}>
                <span className="memory-form__title">Thêm Địa danh hoặc Tông môn / Thế lực</span>
                <div className="memory-form__fields">
                  <input
                    placeholder="Tên Hán (ví dụ: 乌坦城, 云岚宗)"
                    value={newTermHan}
                    onChange={(e) => setNewTermHan(e.target.value)}
                    required
                  />
                  <input
                    placeholder="Tên dịch Việt (ví dụ: Ô Thản thành, Vân Lam Tông)"
                    value={newTermVn}
                    onChange={(e) => setNewTermVn(e.target.value)}
                    required
                  />
                  <select
                    value={newTermCategory}
                    onChange={(e) => setNewTermCategory(e.target.value as any)}
                  >
                    <option value="location">Địa danh</option>
                    <option value="faction">Tông môn / Thế lực</option>
                  </select>
                  <button className="button button--primary" disabled={busy} type="submit">
                    + Thêm
                  </button>
                </div>
              </form>

              <div className="memory-table-wrap">
                <table className="memory-table">
                  <thead>
                    <tr>
                      <th>Tên chữ Hán</th>
                      <th>Bản dịch tiếng Việt</th>
                      <th>Phân loại</th>
                      <th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="memory-table__empty">
                          Chưa có địa danh nào được ghi nhận.
                        </td>
                      </tr>
                    ) : (
                      locations.map((loc) => (
                        <tr key={loc.chinese}>
                          <td><b>{loc.chinese}</b></td>
                          <td><span className="memory-tag memory-tag--location">{loc.vietnamese}</span></td>
                          <td>{loc.category === 'faction' ? 'Tông môn / Thế lực' : 'Địa danh'}</td>
                          <td>
                            <button
                              className="button button--ghost button--tiny"
                              onClick={() => handleDeleteEntity(loc.chinese)}
                              type="button"
                            >
                              <Icon name="trash" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'terms' && (
            <div className="memory-tab-panel">
              <form className="memory-form" onSubmit={handleAddTerm}>
                <span className="memory-form__title">Thêm Thuật ngữ hoặc Cảnh giới / Công pháp</span>
                <div className="memory-form__fields">
                  <input
                    placeholder="Tên Hán (ví dụ: 斗气, 元丹境, 焚诀)"
                    value={newTermHan}
                    onChange={(e) => setNewTermHan(e.target.value)}
                    required
                  />
                  <input
                    placeholder="Bản dịch tiếng Việt (ví dụ: Đấu khí, Nguyên Đan cảnh)"
                    value={newTermVn}
                    onChange={(e) => setNewTermVn(e.target.value)}
                    required
                  />
                  <select
                    value={newTermCategory}
                    onChange={(e) => setNewTermCategory(e.target.value as any)}
                  >
                    <option value="cultivation">Cảnh giới / Công pháp</option>
                    <option value="term">Thuật ngữ chung</option>
                  </select>
                  <button className="button button--primary" disabled={busy} type="submit">
                    + Thêm
                  </button>
                </div>
              </form>

              <div className="memory-table-wrap">
                <table className="memory-table">
                  <thead>
                    <tr>
                      <th>Tên chữ Hán</th>
                      <th>Bản dịch tiếng Việt</th>
                      <th>Phân loại</th>
                      <th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terms.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="memory-table__empty">
                          Chưa có thuật ngữ nào được lưu.
                        </td>
                      </tr>
                    ) : (
                      terms.map((t) => (
                        <tr key={t.chinese}>
                          <td><b>{t.chinese}</b></td>
                          <td><span className="memory-tag memory-tag--term">{t.vietnamese}</span></td>
                          <td>{t.category === 'cultivation' ? 'Cảnh giới/Công pháp' : 'Thuật ngữ'}</td>
                          <td>
                            <button
                              className="button button--ghost button--tiny"
                              onClick={() => handleDeleteEntity(t.chinese)}
                              type="button"
                            >
                              <Icon name="trash" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="memory-tab-panel">
              <form className="memory-form" onSubmit={handleAddRule}>
                <span className="memory-form__title">Quy tắc dịch đặc thù riêng cho bộ truyện</span>
                <div className="memory-form__fields">
                  <input
                    placeholder="Quy tắc (ví dụ: Giữ nguyên tên chiêu thức Hán Việt, không dịch nghĩa)"
                    value={newRuleText}
                    onChange={(e) => setNewRuleText(e.target.value)}
                    style={{ flex: 1 }}
                    required
                  />
                  <button className="button button--primary" disabled={busy} type="submit">
                    + Thêm quy tắc
                  </button>
                </div>
              </form>

              <ul className="memory-rules-list">
                {(currentMemory.customRules || []).length === 0 ? (
                  <p className="memory-table__empty">Chưa có quy tắc đặc biệt nào.</p>
                ) : (
                  currentMemory.customRules?.map((rule, idx) => (
                    <li key={idx} className="memory-rule-item">
                      <span>• {rule}</span>
                      <button
                        className="button button--ghost button--tiny"
                        onClick={() => handleDeleteRule(idx)}
                        type="button"
                      >
                        <Icon name="trash" />
                      </button>
                    </li>
                  ))
                )}
              </ul>

              <div className="memory-subheading" style={{ marginTop: '24px' }}>
                <h4>Mẫu đối thoại gần nhất (AI đang học khí chất đối đáp)</h4>
                <p>Tool tự động lưu giữ các câu đối đáp gần nhất để khi mở chat mới, AI lập tức nắm bắt được tone giọng của nhân vật.</p>
              </div>

              <div className="memory-dialogues-box">
                {(currentMemory.recentDialogues || []).length === 0 ? (
                  <span className="memory-cell--muted">Chưa có câu thoại mẫu nào được ghi nhận.</span>
                ) : (
                  currentMemory.recentDialogues?.map((d, i) => (
                    <div key={i} className="memory-dialogue-item">
                      <span className="memory-dialogue-quote">“</span>
                      <span>{d.snippet}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Foot */}
        <div className="memory-modal__foot">
          <span className="memory-modal__counter">
            Tổng cộng: <b>{currentMemory.entities.length}</b> thực thể,{' '}
            <b>{(currentMemory.relations || []).length}</b> quy ước quan hệ.
          </span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {currentMemory.entities.length > 0 && (
              <button
                className="button button--danger-ghost"
                onClick={handleClearAllMemory}
                disabled={busy}
                type="button"
              >
                Xóa sạch bộ nhớ
              </button>
            )}
            <button className="button button--primary" onClick={onClose} type="button">
              Đóng bảng trí nhớ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
