import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Sparkles, RotateCcw, X, Send, Paperclip, Check, AlertCircle, Calendar, FileText, Link, Lock } from 'lucide-react';
import { aiChatbotApi, leaveApi, type AIChatbotResponse } from '../../services/api';
import './AiChatbotWidget.css';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  sources?: string[];
  tools_used?: string[];
  action_proposal?: AIChatbotResponse['action_proposal'];
  actionConfirmed?: boolean;
}

interface AiChatbotWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
}

interface ActionProposalCardProps {
  msgId: string;
  proposal: NonNullable<AIChatbotResponse['action_proposal']>;
  onConfirm: (
    msgId: string,
    proposal: NonNullable<AIChatbotResponse['action_proposal']>,
    confirmed: boolean,
    customPayload?: Record<string, any>,
    attachmentUrl?: string
  ) => void;
  confirmLoading: boolean;
}

export const ActionProposalCard: React.FC<ActionProposalCardProps> = ({
  msgId,
  proposal,
  onConfirm,
  confirmLoading,
}) => {
  const payload = proposal.payload || {};
  const todayStr = new Date().toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(
    payload.start_date && payload.start_date >= todayStr ? payload.start_date : todayStr
  );
  const [endDate, setEndDate] = useState(
    payload.end_date && payload.end_date >= startDate ? payload.end_date : startDate
  );
  const [reason, setReason] = useState(payload.reason || 'Đăng ký qua Trợ lý AI Chatbot');
  const [proofLink, setProofLink] = useState('');
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLeave = proposal.action_type === 'create_leave_request';
  const availableDays = payload.available_days !== undefined ? Number(payload.available_days) : undefined;

  const calculateDays = () => {
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
    return Math.round((e.getTime() - s.getTime()) / (1000 * 3600 * 24)) + 1;
  };

  const totalDays = calculateDays();
  const isPastDate = startDate < todayStr;
  const isExceeded = availableDays !== undefined && totalDays > availableDays;

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Dung lượng tệp minh chứng tối đa 5MB.');
      return;
    }

    setUploading(true);
    try {
      const res = await leaveApi.uploadProof(file);
      setUploadedUrl(res.proof_url);
      toast.success('Đã tải lên tệp minh chứng thành công!');
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tải lên tệp minh chứng.');
    } finally {
      setUploading(false);
    }
  };

  const handleExecute = () => {
    if (isLeave) {
      if (startDate < todayStr) {
        toast.error('Không thể tạo đơn nghỉ phép cho ngày trong quá khứ. Vui lòng chọn ngày từ hôm nay trở đi.');
        return;
      }
      if (startDate > endDate || totalDays <= 0) {
        toast.error('Ngày bắt đầu nghỉ không được lớn hơn ngày kết thúc.');
        return;
      }
      if (isExceeded) {
        toast.error(`Số ngày nghỉ (${totalDays} ngày) vượt quá số ngày phép còn lại (${availableDays} ngày). Vui lòng điều chỉnh lại.`);
        return;
      }
      if (!reason.trim()) {
        toast.warning('Vui lòng nhập lý do nghỉ phép.');
        return;
      }
      if (proposal.requires_attachment && !uploadedUrl && !proofLink.trim()) {
        toast.warning('Loại đơn này bắt buộc tải lên tệp hoặc dán link minh chứng trước khi xác nhận.');
        return;
      }
    }

    const finalAttachment = uploadedUrl || (proofLink.trim() ? proofLink.trim() : undefined);
    const updatedPayload = {
      ...payload,
      start_date: startDate,
      end_date: endDate,
      total_days: totalDays,
      reason: reason.trim(),
      attachment_url: finalAttachment,
    };

    onConfirm(msgId, proposal, true, updatedPayload, finalAttachment);
  };

  return (
    <div className="ai-action-card">
      <div className="ai-action-card-header">
        <AlertCircle size={14} />
        <span>Yêu cầu xác nhận (HITL): {proposal.title}</span>
      </div>

      <div className="ai-action-card-desc">
        {proposal.description}
      </div>

      {isLeave && (
        <div className="ai-action-form">
          {/* Thời gian nghỉ */}
          <div className="ai-action-field">
            <label className="ai-action-field-label">
              <Calendar size={12} />
              <span>Thời gian nghỉ phép:</span>
              <span className={`ai-action-days-badge ${isExceeded ? 'ai-badge-danger' : ''}`}>
                {totalDays} ngày công {availableDays !== undefined ? `(còn lại: ${availableDays} ngày)` : ''}
              </span>
            </label>
            <div className="ai-action-date-row">
              <input
                type="date"
                className={`ai-action-input ${isPastDate ? 'ai-input-error' : ''}`}
                value={startDate}
                min={todayStr}
                onChange={e => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                disabled={confirmLoading}
              />
              <span className="ai-action-date-separator">đến</span>
              <input
                type="date"
                className="ai-action-input"
                value={endDate}
                min={startDate || todayStr}
                onChange={e => setEndDate(e.target.value)}
                disabled={confirmLoading}
              />
            </div>
            {isPastDate && (
              <span className="ai-field-error-text">⚠️ Không thể chọn ngày trong quá khứ (trước hôm nay).</span>
            )}
            {isExceeded && (
              <span className="ai-field-error-text">⚠️ Số ngày nghỉ vượt quá số ngày phép còn lại ({availableDays} ngày).</span>
            )}
          </div>

          {/* Lý do xin nghỉ */}
          <div className="ai-action-field">
            <label className="ai-action-field-label">
              <FileText size={12} />
              <span>Lý do xin nghỉ:</span>
              <span className="ai-action-field-req">*</span>
            </label>
            <input
              type="text"
              className="ai-action-input"
              placeholder="Nhập lý do xin nghỉ phép..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={confirmLoading}
            />
          </div>

          {/* Minh chứng (Tệp hoặc Link) */}
          <div className="ai-action-field">
            <label className="ai-action-field-label">
              <Paperclip size={12} />
              <span>Minh chứng (Tệp hoặc Liên kết):</span>
              {proposal.requires_attachment && <span className="ai-action-field-req">* (Bắt buộc)</span>}
            </label>

            <div className="ai-action-proof-group">
              <div className="ai-action-proof-top">
                <span className="ai-proof-hint">
                  {proposal.requires_attachment
                    ? 'Yêu cầu giấy khám / viện phí / đơn'
                    : 'Đính kèm tệp nếu có minh chứng'}
                </span>

                {uploadedUrl ? (
                  <span className="ai-upload-success">
                    <Check size={13} /> Đã đính kèm tệp
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ai-btn-upload"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || confirmLoading}
                  >
                    <Paperclip size={12} />
                    {uploading ? 'Đang tải...' : 'Tải tệp lên'}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: 'none' }}
                  onChange={handleUploadFile}
                />
              </div>

              <div className="ai-action-link-row">
                <Link size={12} className="ai-link-icon" />
                <input
                  type="url"
                  className="ai-action-link-input"
                  placeholder="Hoặc dán link minh chứng (Drive, ảnh chứng từ)..."
                  value={proofLink}
                  onChange={e => setProofLink(e.target.value)}
                  disabled={confirmLoading}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div className="ai-action-buttons">
        <button
          type="button"
          className="ai-btn-cancel"
          onClick={() => onConfirm(msgId, proposal, false)}
          disabled={confirmLoading}
        >
          Bỏ qua
        </button>
        <button
          type="button"
          className="ai-btn-confirm"
          onClick={handleExecute}
          disabled={confirmLoading || (isLeave && (totalDays <= 0 || isPastDate || isExceeded))}
        >
          {confirmLoading ? 'Đang xử lý...' : 'Xác nhận thực thi'}
        </button>
      </div>
    </div>
  );
};

export const AiChatbotWidget: React.FC<AiChatbotWidgetProps> = ({ isOpen, onClose, user }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>('');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [uploadedProofUrl, setUploadedProofUrl] = useState<string | null>(null);

  // Khóa khung chat khi đang có yêu cầu xác nhận (HITL) chưa hoàn tất
  const hasPendingHitl = useMemo(
    () => messages.some(m => m.action_proposal && !m.actionConfirmed),
    [messages]
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Khởi tạo phiên hội thoại mới cho mỗi lần tải lại trang (không duy trì thread cũ qua reload)
  const threadIdRef = useRef<string>(
    `thread_user_${user?.user_id || 'guest'}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );

  // Tải lịch sử trò chuyện chính thức từ Supabase PostgreSQL khi mở widget
  useEffect(() => {
    let isSubscribed = true;

    async function loadChatHistory() {
      if (!isOpen) return;

      // Nếu đã có tin nhắn trong phiên hiện tại (người dùng vừa đóng rồi mở lại), giữ nguyên không ghi đè
      if (messages.length > 0) return;

      const currentThread = threadIdRef.current;

      try {
        const res = await aiChatbotApi.getHistory(currentThread);
        if (!isSubscribed) return;

        if (res.messages && res.messages.length > 0) {
          const historyMsgs: Message[] = res.messages.map(m => ({
            id: m.message_id ? String(m.message_id) : String(Math.random()),
            sender: m.sender,
            text: m.content,
            sources: m.sources,
            tools_used: m.tools_used,
            action_proposal: m.action_proposal,
            // Các yêu cầu HITL cũ trong lịch sử thì luôn đánh dấu là đã hoàn tất/xác nhận, không hiện lại
            actionConfirmed: true,
          }));
          setMessages(historyMsgs);
        } else if (messages.length === 0) {
          // Chưa có lịch sử hội thoại, hiển thị thông điệp chào mừng
          setMessages([
            {
              id: 'welcome',
              sender: 'assistant',
              text: `Xin chào **${user?.full_name || user?.username || 'bạn'}**! 👋\n\nTôi là **Trợ lý AI Nhân sự TechZone HRM** (Agentic RAG Mistral AI). Tôi có thể hỗ trợ bạn:\n\n• Tra cứu **Quy chế & Chính sách** (PDF trích dẫn chính thức)\n\n• Kiểm tra **Bảng lương & Phụ cấp dự án**\n• Xem **Số dư phép năm & Lịch làm việc**\n\n• **Tạo đơn xin nghỉ phép** hoặc **Hủy đơn** nhanh chóng có xác nhận (HITL).\n\n⚠️ *Chú ý: Lịch sử cuộc trò chuyện của bạn sẽ được hệ thống lưu lại.*\n\nBạn có thể hỏi tôi câu hỏi bất kỳ bên dưới!`,
            },
          ]);
        }
      } catch {
        if (!isSubscribed) return;
        if (messages.length === 0) {
          setMessages([
            {
              id: 'welcome',
              sender: 'assistant',
              text: `Xin chào **${user?.full_name || user?.username || 'bạn'}**! 👋\n\nTôi là **Trợ lý AI Nhân sự TechZone HRM** (Agentic RAG Mistral AI). Bạn cần tra cứu thông tin hay chính sách nào hôm nay?\n\n⚠️ *Chú ý: Lịch sử cuộc trò chuyện của bạn sẽ được hệ thống lưu lại.*`,
            },
          ]);
        }
      }
    }

    loadChatHistory();

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, user]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamStatus, loading, isOpen]);

  if (!isOpen) return null;

  // Bắt đầu đoạn hội thoại mới (Tạo thread mới)
  const handleNewChat = () => {
    const newThread = `thread_user_${user?.user_id || 'guest'}_${Date.now()}`;
    threadIdRef.current = newThread;
    // Thread id scoped to session
    setMessages([
      {
        id: 'welcome_new',
        sender: 'assistant',
        text: `Đã khởi tạo phiên trò chuyện mới. Xin chào **${user?.full_name || user?.username || 'bạn'}**! Hãy đặt câu hỏi cho tôi.\n\n⚠️ *Chú ý: Lịch sử cuộc trò chuyện của bạn sẽ được hệ thống lưu lại.*`,
      },
    ]);
    toast.success('Đã tạo phiên hội thoại mới.');
  };

  // Gửi câu hỏi kèm Streaming Server-Sent Events (SSE)
  const handleSend = async (queryText?: string) => {
    const q = (queryText || inputText).trim();
    if (!q || loading) return;

    const userMsgId = `user_${Date.now()}`;
    const assistantMsgId = `asst_${Date.now() + 1}`;

    const userMsg: Message = { id: userMsgId, sender: 'user', text: q };
    const emptyAsstMsg: Message = { id: assistantMsgId, sender: 'assistant', text: '' };

    setMessages(prev => [...prev, userMsg, emptyAsstMsg]);
    setInputText('');
    setLoading(true);
    setStreamStatus('Đang chuẩn bị câu trả lời...');

    const currentThread = threadIdRef.current;

    try {
      await aiChatbotApi.streamQuery(q, currentThread, {
        onStart: (data) => {
          if (data.thread_id) {
            threadIdRef.current = data.thread_id;
            // Thread id scoped to session
          }
        },
        onStatus: (statusMsg) => {
          setStreamStatus(statusMsg);
        },
        onToken: (token) => {
          setStreamStatus('');
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId ? { ...m, text: m.text + token } : m
            )
          );
        },
        onDone: (data) => {
          setStreamStatus('');
          if (data.thread_id) {
            threadIdRef.current = data.thread_id;
            // Thread id scoped to session
          }
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    text: data.answer || m.text,
                    sources: data.sources,
                    tools_used: data.tools_used,
                    action_proposal: data.action_proposal,
                  }
                : m
            )
          );
        },
        onError: (err) => {
          setStreamStatus('');
          toast.error(err.message || 'Lỗi kết nối Trợ lý AI');
        },
      });
    } catch (err: any) {
      setStreamStatus('');
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? {
                ...m,
                text: m.text || `⚠️ **Lỗi:** ${err?.message || 'Có lỗi xảy ra trong quá trình xử lý.'}`,
              }
            : m
        )
      );
    } finally {
      setLoading(false);
      setStreamStatus('');
    }
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Dung lượng tệp minh chứng tối đa 5MB.');
      return;
    }

    setUploadingProof(true);
    try {
      const res = await leaveApi.uploadProof(file);
      setUploadedProofUrl(res.proof_url);
      toast.success('Đã tải lên tệp minh chứng thành công!');
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tải lên tệp minh chứng.');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleConfirmAction = async (
    msgId: string,
    proposal: NonNullable<AIChatbotResponse['action_proposal']>,
    confirmed: boolean,
    customPayload?: Record<string, any>,
    attachmentUrl?: string
  ) => {
    if (!confirmed) {
      setMessages(prev =>
        prev.map(m => m.id === msgId ? { ...m, actionConfirmed: true } : m)
      );
      toast('Đã hủy bỏ thao tác theo yêu cầu.');
      return;
    }

    setConfirmLoading(true);
    try {
      const res = await aiChatbotApi.confirmAction({
        action_type: proposal.action_type,
        payload: customPayload || proposal.payload,
        confirmed: true,
        attachment_url: attachmentUrl || uploadedProofUrl || undefined,
        thread_id: threadIdRef.current,
      });

      setMessages(prev => [
        ...prev.map(m => m.id === msgId ? { ...m, actionConfirmed: true } : m),
        {
          id: `asst_${Date.now()}`,
          sender: 'assistant',
          text: `✅ **Thành công:** ${res.message || 'Đã ghi nhận yêu cầu vào hệ thống CSDL TechZone!'}`,
        },
      ]);
      setUploadedProofUrl(null);
      toast.success(res.message || 'Thao tác hoàn tất!');
    } catch (err: any) {
      toast.error(err?.message || 'Không thể thực hiện hành động này.');
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <>
      <div className="ai-widget-backdrop" onClick={onClose} />
      <div className="ai-chatbot-window" role="dialog" aria-modal="true">
        {/* Header - Phong cách Vero Minimalism hài hòa với Topbar */}
        <div className="ai-header">
          <div className="ai-header-left">
            <div className="ai-logo-badge" title="TechZone AI Copilot">
              <Sparkles size={15} strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="ai-header-title">
                Trợ lý AI TechZone
                <span className="ai-online-dot" title="Hệ thống AI đang kết nối trực tiếp CSDL và vận hành ổn định" />
              </h3>
              <p className="ai-header-subtitle">Agentic RAG • LangGraph & Mistral AI</p>
            </div>
          </div>
          <div className="ai-header-actions">
            <button
              className="ai-btn-icon"
              onClick={handleNewChat}
              title="Khởi tạo phiên hội thoại mới"
              aria-label="Khởi tạo phiên hội thoại mới"
            >
              <RotateCcw size={15} />
            </button>
            <button
              className="ai-btn-icon"
              onClick={onClose}
              title="Đóng cửa sổ"
              aria-label="Đóng cửa sổ"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Message Container */}
        <div className="ai-messages-container">
          {messages.map(msg => (
            <div key={msg.id} className={`ai-message ${msg.sender}`}>
              <div className="ai-message-bubble">
                {/* Render Markdown chuyên nghiệp */}
                <div className="ai-markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.text || (loading && msg.sender === 'assistant' ? ' ' : '')}
                  </ReactMarkdown>
                </div>

                {/* Sources & Tools Badges */}
                {msg.sender === 'assistant' && (
                  <div className="ai-meta-group">
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="ai-pill-list">
                        {msg.sources.map((s, idx) => (
                          <span key={idx} className="ai-pill ai-pill-source" title="Căn cứ tài liệu PDF chính sách TechZone">
                            📄 {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.tools_used && msg.tools_used.length > 0 && (
                      <div className="ai-pill-list">
                        {msg.tools_used.map((t, idx) => (
                          <span key={idx} className="ai-pill ai-pill-tool" title="Đã gọi HRM Agent Tool">
                            ⚡ {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Action Proposal Card (HITL) */}
                {msg.action_proposal && !msg.actionConfirmed && (
                  <ActionProposalCard
                    msgId={msg.id}
                    proposal={msg.action_proposal}
                    onConfirm={handleConfirmAction}
                    confirmLoading={confirmLoading}
                  />
                )}
              </div>
            </div>
          ))}

          {/* Trạng thái Streaming thời gian thực */}
          {loading && streamStatus && (
            <div className="ai-streaming-status-bar">
              <span className="ai-status-spinner" />
              <span>{streamStatus}</span>
            </div>
          )}

          {/* Quick Prompts khi mới mở hoặc chưa có nhiều hội thoại */}
          {messages.length === 1 && (
            <div className="ai-quick-prompts">
              <span className="ai-quick-prompts-label">Gợi ý câu hỏi nhanh:</span>
              <button
                className="ai-quick-btn" disabled={hasPendingHitl}
                onClick={() => handleSend('Xem bảng lương tháng này của tôi')}
              >
                <Sparkles size={13} className="ai-quick-icon" />
                <span>Bảng lương & phụ cấp dự án tháng này của tôi</span>
              </button>
              <button
                className="ai-quick-btn" disabled={hasPendingHitl}
                onClick={() => handleSend('Tôi còn bao nhiêu ngày phép năm?')}
              >
                <Sparkles size={13} className="ai-quick-icon" />
                <span>Số dư ngày phép năm còn lại của tôi</span>
              </button>
              <button
                className="ai-quick-btn" disabled={hasPendingHitl}
                onClick={() => handleSend('Quy định xử lý nhân viên đi trễ trên 15 phút như thế nào?')}
              >
                <Sparkles size={13} className="ai-quick-icon" />
                <span>Quy định phạt đi trễ trên 15 phút tại chuỗi cửa hàng</span>
              </button>
              <button
                className="ai-quick-btn" disabled={hasPendingHitl}
                onClick={() => handleSend('Các dự án và mức phụ cấp tôi đang tham gia')}
              >
                <Sparkles size={13} className="ai-quick-icon" />
                <span>Dự án và phụ cấp hàng tháng tôi đang tham gia</span>
              </button>
            </div>
          )}

          {loading && !streamStatus && (
            <div className="ai-message assistant">
              <div className="ai-message-bubble">
                <div className="ai-typing-indicator">
                  <div className="ai-typing-dot" />
                  <div className="ai-typing-dot" />
                  <div className="ai-typing-dot" />
                  <span className="ai-typing-text">Trợ lý AI đang phản hồi...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* HITL Pending Lock Banner */}
        {hasPendingHitl && (
          <div className="ai-hitl-lock-banner">
            <Lock size={13} className="ai-lock-icon" />
            <span>Đang chờ bạn phản hồi yêu cầu (HITL). Vui lòng <strong>Xác nhận</strong> hoặc <strong>Bỏ qua</strong> phía trên để tiếp tục trò chuyện.</span>
          </div>
        )}

        {/* Input Bar */}
        <div className="ai-input-bar">
          <input
            type="text"
            className="ai-input-field"
            placeholder={
              hasPendingHitl
                ? "Vui lòng 'Xác nhận' hoặc 'Bỏ qua' yêu cầu phía trên để tiếp tục..."
                : "Hỏi về quy chế, dự án, lương, phép năm..."
            }
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !hasPendingHitl) handleSend();
            }}
            disabled={loading || hasPendingHitl}
          />
          <button
            className="ai-send-btn"
            onClick={() => handleSend()}
            disabled={!inputText.trim() || loading || hasPendingHitl}
            title={hasPendingHitl ? "Vui lòng xác nhận hoặc bỏ qua yêu cầu phía trên" : "Gửi câu hỏi"}
            aria-label="Gửi câu hỏi"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </>
  );
};
