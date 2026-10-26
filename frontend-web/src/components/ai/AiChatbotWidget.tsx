import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Sparkles, RotateCcw, X, Send, Paperclip, Check, AlertCircle } from 'lucide-react';
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

export const AiChatbotWidget: React.FC<AiChatbotWidgetProps> = ({ isOpen, onClose, user }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>('');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [uploadedProofUrl, setUploadedProofUrl] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lưu trữ thread_id vào localStorage để duy trì mạch hội thoại khi reload
  const threadIdRef = useRef<string>(
    localStorage.getItem('hrm_ai_thread_id') || `thread_user_${user?.user_id || 'guest'}_${Date.now()}`
  );

  // Tải lịch sử trò chuyện chính thức từ Supabase PostgreSQL khi mở widget
  useEffect(() => {
    let isSubscribed = true;

    async function loadChatHistory() {
      if (!isOpen) return;

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
          }));
          setMessages(historyMsgs);
        } else if (messages.length === 0) {
          // Chưa có lịch sử hội thoại, hiển thị thông điệp chào mừng
          setMessages([
            {
              id: 'welcome',
              sender: 'assistant',
              text: `Xin chào **${user?.full_name || user?.username || 'bạn'}**! 👋\n\nTôi là **Trợ lý AI Nhân sự TechZone HRM** (Agentic RAG Mistral AI). Tôi có thể hỗ trợ bạn:\n\n• Tra cứu **Quy chế & Chính sách** (PDF trích dẫn chính thức)\n• Kiểm tra **Bảng lương & Phụ cấp dự án**\n• Xem **Số dư phép năm & Lịch làm việc**\n• **Tạo đơn xin nghỉ phép** hoặc **Hủy đơn** nhanh chóng có xác nhận (HITL).\n\nBạn có thể hỏi tôi câu hỏi bất kỳ bên dưới!`,
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
              text: `Xin chào **${user?.full_name || user?.username || 'bạn'}**! 👋\n\nTôi là **Trợ lý AI Nhân sự TechZone HRM** (Agentic RAG Mistral AI). Bạn cần tra cứu thông tin hay chính sách nào hôm nay?`,
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
    localStorage.setItem('hrm_ai_thread_id', newThread);
    setMessages([
      {
        id: 'welcome_new',
        sender: 'assistant',
        text: `Đã khởi tạo phiên trò chuyện mới. Xin chào **${user?.full_name || user?.username || 'bạn'}**! Hãy đặt câu hỏi cho tôi.`,
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
            localStorage.setItem('hrm_ai_thread_id', data.thread_id);
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
            localStorage.setItem('hrm_ai_thread_id', data.thread_id);
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

  const handleConfirmAction = async (msgId: string, proposal: NonNullable<AIChatbotResponse['action_proposal']>, confirmed: boolean) => {
    if (!confirmed) {
      setMessages(prev =>
        prev.map(m => m.id === msgId ? { ...m, actionConfirmed: true } : m)
      );
      toast('Đã hủy bỏ thao tác theo yêu cầu.');
      return;
    }

    if (proposal.requires_attachment && !uploadedProofUrl) {
      toast.warning('Vui lòng tải lên tệp minh chứng (giấy viện phí / khám chữa bệnh) trước khi xác nhận.');
      return;
    }

    setConfirmLoading(true);
    try {
      const res = await aiChatbotApi.confirmAction({
        action_type: proposal.action_type,
        payload: proposal.payload,
        confirmed: true,
        attachment_url: uploadedProofUrl || undefined,
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
                  <div className="ai-action-card">
                    <div className="ai-action-card-header">
                      <AlertCircle size={14} />
                      <span>Yêu cầu xác nhận (HITL): {msg.action_proposal.title}</span>
                    </div>
                    <div className="ai-action-card-desc">
                      {msg.action_proposal.description}
                    </div>

                    {msg.action_proposal.requires_attachment && (
                      <div className="ai-action-upload">
                        <span>Minh chứng y tế / đơn từ:</span>
                        {uploadedProofUrl ? (
                          <span className="ai-upload-success">
                            <Check size={13} /> Đã đính kèm tệp
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="ai-btn-upload"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingProof}
                          >
                            <Paperclip size={13} />
                            {uploadingProof ? 'Đang tải lên...' : 'Đính kèm tệp'}
                          </button>
                        )}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,application/pdf"
                          style={{ display: 'none' }}
                          onChange={handleUploadProof}
                        />
                      </div>
                    )}

                    <div className="ai-action-buttons">
                      <button
                        type="button"
                        className="ai-btn-cancel"
                        onClick={() => handleConfirmAction(msg.id, msg.action_proposal!, false)}
                        disabled={confirmLoading}
                      >
                        Bỏ qua
                      </button>
                      <button
                        type="button"
                        className="ai-btn-confirm"
                        onClick={() => handleConfirmAction(msg.id, msg.action_proposal!, true)}
                        disabled={confirmLoading}
                      >
                        {confirmLoading ? 'Đang xử lý...' : 'Xác nhận thực thi'}
                      </button>
                    </div>
                  </div>
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
                className="ai-quick-btn"
                onClick={() => handleSend('Xem bảng lương tháng này của tôi')}
              >
                <Sparkles size={13} className="ai-quick-icon" />
                <span>Bảng lương & phụ cấp dự án tháng này của tôi</span>
              </button>
              <button
                className="ai-quick-btn"
                onClick={() => handleSend('Tôi còn bao nhiêu ngày phép năm?')}
              >
                <Sparkles size={13} className="ai-quick-icon" />
                <span>Số dư ngày phép năm còn lại của tôi</span>
              </button>
              <button
                className="ai-quick-btn"
                onClick={() => handleSend('Quy định xử lý nhân viên đi trễ trên 15 phút như thế nào?')}
              >
                <Sparkles size={13} className="ai-quick-icon" />
                <span>Quy định phạt đi trễ trên 15 phút tại chuỗi cửa hàng</span>
              </button>
              <button
                className="ai-quick-btn"
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

        {/* Input Bar */}
        <div className="ai-input-bar">
          <input
            type="text"
            className="ai-input-field"
            placeholder="Hỏi về quy chế, dự án, lương, phép năm..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSend();
            }}
            disabled={loading}
          />
          <button
            className="ai-send-btn"
            onClick={() => handleSend()}
            disabled={!inputText.trim() || loading}
            title="Gửi câu hỏi"
            aria-label="Gửi câu hỏi"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </>
  );
};
