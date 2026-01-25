import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession } from '../lib/useSession';
import { nanoid } from 'nanoid';
import { Copy, Check } from 'lucide-react';

interface ChatMessage {
  id: string;
  ts: number;
  name: string;
  text: string;
}

// Escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function Chat() {
  const { doc, localName } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get Y.Array for chat messages
  const chatArray = doc.getArray<ChatMessage>('chat');

  // Sync messages from Yjs
  useEffect(() => {
    const updateMessages = () => {
      setMessages(chatArray.toArray());
    };

    updateMessages();
    chatArray.observe(updateMessages);

    return () => {
      chatArray.unobserve(updateMessages);
    };
  }, [chatArray]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;

      const message: ChatMessage = {
        id: nanoid(8),
        ts: Date.now(),
        name: localName,
        text,
      };

      chatArray.push([message]);
      setInput('');
    },
    [input, localName, chatArray],
  );

  // Handle copying message text to clipboard
  const handleCopy = useCallback(async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 1000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 px-4 pb-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3 shrink-0">
        Chat
      </h3>

      {/* Messages container - scrollable */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-0 pr-1">
        {messages.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">
            No messages yet. Start the conversation!
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className="group relative bg-panel-2 rounded-lg px-3 py-2"
            >
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold text-primary">
                  {escapeHtml(msg.name)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="copy-btn w-5 h-5 flex items-center justify-center rounded text-text-muted
                               hover:text-text hover:bg-panel transition-colors
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => handleCopy(msg)}
                    aria-label="Copy message"
                    title="Copy message"
                  >
                    {copiedId === msg.id ? (
                      <Check className="w-3 h-3 text-success" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  <span className="text-[10px] text-text-muted">
                    {new Date(msg.ts).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
              <p className="text-sm text-text wrap-break-word">
                {escapeHtml(msg.text)}
              </p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input form - fixed at bottom */}
      <form className="flex gap-2 mt-3 shrink-0" onSubmit={handleSend}>
        <input
          type="text"
          className="flex-1 min-w-0 bg-panel-2 border border-border rounded-lg px-3 py-2 text-sm text-text
                     placeholder:text-text-muted
                     focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary
                     transition-colors"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          maxLength={500}
        />
        <button
          type="submit"
          className="shrink-0 bg-primary text-white px-4 py-2 text-sm font-medium rounded-lg
                     hover:bg-primary-hover transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          disabled={!input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
