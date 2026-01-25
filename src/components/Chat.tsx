import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession } from '../lib/useSession';
import { nanoid } from 'nanoid';
import { Copy, Check, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

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
  const [messageToDelete, setMessageToDelete] = useState<ChatMessage | null>(
    null,
  );
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

  // Handle deleting own messages (called after confirmation)
  const confirmDelete = useCallback(() => {
    if (!messageToDelete) return;
    // Only allow deleting own messages
    if (messageToDelete.name !== localName) return;

    const index = chatArray
      .toArray()
      .findIndex((m) => m.id === messageToDelete.id);
    if (index !== -1) {
      doc.transact(() => {
        chatArray.delete(index, 1);
      });
    }
    setMessageToDelete(null);
  }, [chatArray, doc, localName, messageToDelete]);

  // Handle keyboard input for multi-line messages
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter without modifiers sends the message
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
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
      }
      // Shift+Enter, Ctrl+Enter, Cmd+Enter insert a newline (default textarea behavior)
    },
    [input, localName, chatArray],
  );

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
          messages.map((msg) => {
            const isOwn = msg.name === localName;
            return (
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
                    {isOwn && (
                      <button
                        className="copy-btn w-5 h-5 flex items-center justify-center rounded text-text-muted
                                   hover:text-danger hover:bg-danger/10 transition-colors
                                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                        onClick={() => setMessageToDelete(msg)}
                        aria-label="Delete message"
                        title="Delete message"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                    <span className="text-[10px] text-text-muted">
                      {new Date(msg.ts).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-text wrap-break-word whitespace-pre-wrap">
                  {escapeHtml(msg.text)}
                </p>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input form - fixed at bottom */}
      <form className="flex gap-2 mt-3 shrink-0" onSubmit={handleSend}>
        <textarea
          className="flex-1 min-w-0 bg-panel-2 border border-border rounded-lg px-3 py-2 text-sm text-text
                     placeholder:text-text-muted resize-none
                     focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary
                     transition-colors"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          maxLength={2000}
          rows={2}
        />
        <button
          type="submit"
          className="shrink-0 self-end bg-primary text-white px-4 py-2 text-sm font-medium rounded-lg
                     hover:bg-primary-hover transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          disabled={!input.trim()}
        >
          Send
        </button>
      </form>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!messageToDelete}
        onOpenChange={(open) => !open && setMessageToDelete(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Message?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this message? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMessageToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
