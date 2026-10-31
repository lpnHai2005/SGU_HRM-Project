import React, { useState } from 'react';
import { Plus, Trash2, Search, RotateCcw, X, Filter } from 'lucide-react';
import './AdvancedSearchModal.css';

export type FieldType = 'string' | 'number' | 'date' | 'select';

export interface SearchFieldConfig {
  key: string;
  label: string;
  type: FieldType;
  options?: { label: string; value: string | number }[];
  placeholder?: string;
}

export type RelationalOperator = 
  | '=' 
  | '!=' 
  | '>' 
  | '<' 
  | '>=' 
  | '<=' 
  | 'CONTAINS' 
  | 'NOT_CONTAINS'
  | 'STARTS_WITH'
  | 'ENDS_WITH';

export type LogicalOperator = 'AND' | 'OR';

export interface SearchCondition {
  id: string;
  logic: LogicalOperator; // Logic nối với điều kiện trước đó
  isNot: boolean;         // Phép toán NOT phủ định
  fieldKey: string;
  operator: RelationalOperator;
  value: string;
}

export interface AdvancedSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  fields: SearchFieldConfig[];
  conditions: SearchCondition[];
  onApply: (conditions: SearchCondition[]) => void;
  onReset?: () => void;
  title?: string;
  subtitle?: string;
}

// Danh sách phép toán quan hệ tương ứng cho từng loại dữ liệu
export const getOperatorsForType = (type: FieldType): { label: string; value: RelationalOperator }[] => {
  switch (type) {
    case 'number':
      return [
        { label: 'Bằng (=)', value: '=' },
        { label: 'Khác (!=)', value: '!=' },
        { label: 'Lớn hơn (>)', value: '>' },
        { label: 'Nhỏ hơn (<)', value: '<' },
        { label: 'Từ mức này trở lên (>=)', value: '>=' },
        { label: 'Từ mức này trở xuống (<=)', value: '<=' },
      ];
    case 'date':
      return [
        { label: 'Vào đúng ngày (=)', value: '=' },
        { label: 'Khác ngày (!=)', value: '!=' },
        { label: 'Sau ngày (>)', value: '>' },
        { label: 'Trước ngày (<)', value: '<' },
        { label: 'Từ ngày này trở đi (>=)', value: '>=' },
        { label: 'Đến ngày này (<=)', value: '<=' },
      ];
    case 'select':
      return [
        { label: 'Chính xác là (=)', value: '=' },
        { label: 'Không phải là (!=)', value: '!=' },
      ];
    case 'string':
    default:
      return [
        { label: 'Có chứa từ khóa', value: 'CONTAINS' },
        { label: 'Không chứa từ khóa', value: 'NOT_CONTAINS' },
        { label: 'Chính xác là (=)', value: '=' },
        { label: 'Khác với (!=)', value: '!=' },
        { label: 'Bắt đầu bằng', value: 'STARTS_WITH' },
        { label: 'Kết thúc bằng', value: 'ENDS_WITH' },
      ];
  }
};

/**
 * Hàm đánh giá logic nâng cao: Lọc danh sách dữ liệu client-side 
 * Hỗ trợ toán tử quan hệ >, <, =, AND, OR, NOT trên nhiều fields
 */
export function evaluateAdvancedSearch<T = any>(
  item: T,
  conditions: SearchCondition[],
  fieldsConfig: SearchFieldConfig[]
): boolean {
  if (!conditions || conditions.length === 0) return true;

  // Lọc bỏ những điều kiện chưa nhập giá trị
  const validConditions = conditions.filter(c => c.value !== undefined && c.value !== null && String(c.value).trim() !== '');
  if (validConditions.length === 0) return true;

  const fieldMap = new Map(fieldsConfig.map(f => [f.key, f]));

  // Đánh giá từng điều kiện đơn lẻ
  const evaluateSingle = (cond: SearchCondition): boolean => {
    const field = fieldMap.get(cond.fieldKey);
    const rawVal = (item as any)[cond.fieldKey];
    const targetVal = cond.value;

    let res = false;
    const type = field ? field.type : 'string';

    if (type === 'number') {
      const numItem = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal || 0).replace(/[^\d.-]/g, ''));
      const numTarget = parseFloat(String(targetVal).replace(/[^\d.-]/g, ''));
      if (isNaN(numItem) || isNaN(numTarget)) {
        res = false;
      } else {
        switch (cond.operator) {
          case '=': res = numItem === numTarget; break;
          case '!=': res = numItem !== numTarget; break;
          case '>': res = numItem > numTarget; break;
          case '<': res = numItem < numTarget; break;
          case '>=': res = numItem >= numTarget; break;
          case '<=': res = numItem <= numTarget; break;
          default: res = numItem === numTarget;
        }
      }
    } else if (type === 'date') {
      const dateItem = new Date(rawVal).getTime();
      const dateTarget = new Date(targetVal).getTime();
      if (isNaN(dateItem) || isNaN(dateTarget)) {
        res = false;
      } else {
        switch (cond.operator) {
          case '=': res = dateItem === dateTarget; break;
          case '!=': res = dateItem !== dateTarget; break;
          case '>': res = dateItem > dateTarget; break;
          case '<': res = dateItem < dateTarget; break;
          case '>=': res = dateItem >= dateTarget; break;
          case '<=': res = dateItem <= dateTarget; break;
          default: res = dateItem === dateTarget;
        }
      }
    } else {
      // String / Select
      const strItem = String(rawVal ?? '').toLowerCase().trim();
      const strTarget = String(targetVal ?? '').toLowerCase().trim();
      switch (cond.operator) {
        case '=': res = strItem === strTarget; break;
        case '!=': res = strItem !== strTarget; break;
        case 'CONTAINS': res = strItem.includes(strTarget); break;
        case 'NOT_CONTAINS': res = !strItem.includes(strTarget); break;
        case 'STARTS_WITH': res = strItem.startsWith(strTarget); break;
        case 'ENDS_WITH': res = strItem.endsWith(strTarget); break;
        default: res = strItem.includes(strTarget);
      }
    }

    // Áp dụng phép toán NOT phủ định nếu có
    return cond.isNot ? !res : res;
  };

  // Tính toán chuỗi logic AND / OR theo thứ tự từ trái sang phải
  let finalResult = evaluateSingle(validConditions[0]);

  for (let i = 1; i < validConditions.length; i++) {
    const current = validConditions[i];
    const currentEval = evaluateSingle(current);

    if (current.logic === 'OR') {
      finalResult = finalResult || currentEval;
    } else {
      // Mặc định là AND
      finalResult = finalResult && currentEval;
    }
  }

  return finalResult;
}

export const AdvancedSearchModal: React.FC<AdvancedSearchModalProps> = ({
  isOpen,
  onClose,
  fields,
  conditions,
  onApply,
  onReset,
  title = 'Tìm kiếm nâng cao đa điều kiện',
  subtitle = 'Hỗ trợ phép toán quan hệ (>, <, =, !=) và toán tử logic (AND, OR, NOT) trên nhiều trường',
}) => {
  const [localConditions, setLocalConditions] = useState<SearchCondition[]>(() => {
    if (conditions && conditions.length > 0) return conditions;
    // Khởi tạo 1 điều kiện mặc định
    return [{
      id: 'cond_init',
      logic: 'AND',
      isNot: false,
      fieldKey: fields[0]?.key || '',
      operator: fields[0]?.type === 'number' ? '>=' : 'CONTAINS',
      value: '',
    }];
  });

  if (!isOpen) return null;

  const handleAddCondition = () => {
    const defaultField = fields[0];
    const newCond: SearchCondition = {
      id: `cond_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      logic: 'AND',
      isNot: false,
      fieldKey: defaultField?.key || '',
      operator: defaultField?.type === 'number' ? '>=' : 'CONTAINS',
      value: '',
    };
    setLocalConditions(prev => [...prev, newCond]);
  };

  const handleRemoveCondition = (index: number) => {
    setLocalConditions(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleFieldChange = (index: number, newFieldKey: string) => {
    const targetField = fields.find(f => f.key === newFieldKey);
    const newOperator = targetField?.type === 'number' ? '>=' : targetField?.type === 'date' ? '>=' : 'CONTAINS';

    setLocalConditions(prev => prev.map((cond, idx) => {
      if (idx !== index) return cond;
      return {
        ...cond,
        fieldKey: newFieldKey,
        operator: newOperator,
        value: targetField?.type === 'select' && targetField.options?.length ? String(targetField.options[0].value) : '',
      };
    }));
  };

  const handleOperatorChange = (index: number, newOperator: RelationalOperator) => {
    setLocalConditions(prev => prev.map((cond, idx) => {
      if (idx !== index) return cond;
      return { ...cond, operator: newOperator };
    }));
  };

  const handleValueChange = (index: number, val: string) => {
    setLocalConditions(prev => prev.map((cond, idx) => {
      if (idx !== index) return cond;
      return { ...cond, value: val };
    }));
  };

  const handleLogicChange = (index: number, logic: LogicalOperator) => {
    setLocalConditions(prev => prev.map((cond, idx) => {
      if (idx !== index) return cond;
      return { ...cond, logic };
    }));
  };

  const handleToggleNot = (index: number) => {
    setLocalConditions(prev => prev.map((cond, idx) => {
      if (idx !== index) return cond;
      return { ...cond, isNot: !cond.isNot };
    }));
  };

  const handleApply = () => {
    const valid = localConditions.filter(c => c.value !== undefined && c.value !== null && String(c.value).trim() !== '');
    onApply(valid);
    onClose();
  };

  const handleReset = () => {
    setLocalConditions([{
      id: 'cond_init',
      logic: 'AND',
      isNot: false,
      fieldKey: fields[0]?.key || '',
      operator: fields[0]?.type === 'number' ? '>=' : 'CONTAINS',
      value: '',
    }]);
    if (onReset) onReset();
    onClose();
  };

  return (
    <div className="adv-modal-overlay" onClick={onClose}>
      <div className="adv-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="adv-modal-header">
          <div className="adv-header-title-wrap">
            <div className="adv-header-badge">
              <Filter size={16} />
              <span>BỘ LỌC TÌM KIẾM CHI TIẾT</span>
            </div>
            <h3 className="adv-modal-title">{title}</h3>
            {subtitle && <p className="adv-modal-subtitle">{subtitle}</p>}
          </div>
          <button className="adv-modal-close-btn" onClick={onClose} title="Đóng">
            <X size={20} />
          </button>
        </div>

        {/* Body: Danh sách điều kiện */}
        <div className="adv-modal-body">
          {localConditions.length === 0 ? (
            <div className="adv-empty-state">
              <Filter size={32} />
              <p>Chưa có điều kiện lọc nào được thiết lập</p>
              <button className="btn btn-primary btn-sm" onClick={handleAddCondition}>
                <Plus size={14} /> Thêm điều kiện lọc
              </button>
            </div>
          ) : (
            <div className="adv-conditions-list">
              {localConditions.map((cond, index) => {
                const currentField = fields.find(f => f.key === cond.fieldKey) || fields[0];
                const availableOperators = getOperatorsForType(currentField?.type || 'string');

                return (
                  <div key={cond.id || index} className="adv-condition-row">
                    {/* Cột 1: Phép nối Logic AND / OR (áp dụng từ dòng thứ 2) */}
                    <div className="adv-logic-col">
                      {index === 0 ? (
                        <span className="adv-logic-tag start">ĐIỀU KIỆN 1</span>
                      ) : (
                        <select
                          className="adv-select logic-select"
                          value={cond.logic}
                          onChange={(e) => handleLogicChange(index, e.target.value as LogicalOperator)}
                        >
                          <option value="AND">Và (Đồng thời)</option>
                          <option value="OR">Hoặc</option>
                        </select>
                      )}
                    </div>

                    {/* Nút Toggle NOT (Phủ định) */}
                    <button
                      type="button"
                      className={`adv-not-btn ${cond.isNot ? 'active' : ''}`}
                      onClick={() => handleToggleNot(index)}
                      title={cond.isNot ? "Đang bật ngoại trừ (Không phải điều kiện này)" : "Bật ngoại trừ"}
                    >
                      {cond.isNot ? 'Ngoại trừ' : 'Ngoại trừ'}
                    </button>

                    {/* Cột 2: Chọn Trường (Field) */}
                    <div className="adv-field-col">
                      <select
                        className="adv-select"
                        value={cond.fieldKey}
                        onChange={(e) => handleFieldChange(index, e.target.value)}
                      >
                        {fields.map(f => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Cột 3: Phép toán quan hệ (Operator) */}
                    <div className="adv-operator-col">
                      <select
                        className="adv-select"
                        value={cond.operator}
                        onChange={(e) => handleOperatorChange(index, e.target.value as RelationalOperator)}
                      >
                        {availableOperators.map(op => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Cột 4: Giá trị so sánh (Value) */}
                    <div className="adv-value-col">
                      {currentField?.type === 'select' && currentField.options ? (
                        <select
                          className="adv-select"
                          value={cond.value}
                          onChange={(e) => handleValueChange(index, e.target.value)}
                        >
                          <option value="">-- Chọn giá trị --</option>
                          {currentField.options.map(opt => (
                            <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      ) : currentField?.type === 'date' ? (
                        <input
                          type="date"
                          className="adv-input"
                          value={cond.value}
                          onChange={(e) => handleValueChange(index, e.target.value)}
                        />
                      ) : currentField?.type === 'number' ? (
                        <input
                          type="number"
                          className="adv-input"
                          placeholder={currentField.placeholder || 'Nhập số (vd: 10000000)'}
                          value={cond.value}
                          onChange={(e) => handleValueChange(index, e.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          className="adv-input"
                          placeholder={currentField?.placeholder || 'Nhập từ khóa tìm kiếm...'}
                          value={cond.value}
                          onChange={(e) => handleValueChange(index, e.target.value)}
                        />
                      )}
                    </div>

                    {/* Nút Xóa dòng */}
                    <button
                      type="button"
                      className="adv-delete-btn"
                      onClick={() => handleRemoveCondition(index)}
                      title="Xóa điều kiện này"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Nút Thêm dòng điều kiện */}
          <div className="adv-add-action-wrap">
            <button type="button" className="adv-add-btn" onClick={handleAddCondition}>
              <Plus size={16} />
              <span>Thêm điều kiện liên kết (AND / OR)</span>
            </button>
          </div>

          {/* Tóm tắt biểu thức logic đang xây dựng */}
          <div className="adv-expression-preview">
            <div className="adv-expr-label">CÂU TRUY VẤN LOGIC ĐANG ÁP DỤNG:</div>
            <div className="adv-expr-content">
              {localConditions.filter(c => c.value !== '').length === 0 ? (
                <span className="adv-expr-empty">Tất cả dữ liệu (Chưa kích hoạt bộ lọc nâng cao)</span>
              ) : (
                localConditions.filter(c => c.value !== '').map((c, i) => {
                  const f = fields.find(field => field.key === c.fieldKey);
                  return (
                    <span key={c.id || i} className="adv-expr-chip">
                      {i > 0 && <strong className="adv-expr-logic">{c.logic}</strong>}
                      {c.isNot && <strong className="adv-expr-not">NOT</strong>}
                      <span className="adv-expr-field">[{f?.label || c.fieldKey}]</span>
                      <span className="adv-expr-op">{c.operator}</span>
                      <span className="adv-expr-val">"{c.value}"</span>
                    </span>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="adv-modal-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
            <RotateCcw size={14} />
            <span>Đặt lại (Xóa lọc)</span>
          </button>
          <div className="adv-footer-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Đóng
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleApply}>
              <Search size={14} />
              <span>Áp dụng bộ lọc</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
