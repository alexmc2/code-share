import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { nanoid } from 'nanoid';
import { Copy, Check, Trash2, Smile } from 'lucide-react';
import EmojiPicker, { Theme as EmojiTheme } from 'emoji-picker-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import * as Y from 'yjs';

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

interface ChatProps {
  soundEnabled?: boolean;
}

export function Chat({ soundEnabled = true }: ChatProps) {
  const { doc, localName, localPeerId, participants } = useSession();
  const { theme } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<ChatMessage | null>(
    null,
  );

  // Emoji reaction state
  const [reactions, setReactions] = useState<
    Record<string, Record<string, Set<string>>>
  >({});
  const [reactionPickerOpen, setReactionPickerOpen] = useState<string | null>(
    null,
  );
  const [inputEmojiPickerOpen, setInputEmojiPickerOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasUnlockedAudio = useRef(false);

  // Update ref when prop changes
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Get Y.Map for chat reactions
  const chatReactions = doc.getMap<Y.Map<Y.Map<number>>>('chatReactions');

  // Helper: Toggle a reaction for the current user
  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      doc.transact(() => {
        let msgMap = chatReactions.get(messageId);
        if (!msgMap) {
          msgMap = new Y.Map<Y.Map<number>>();
          chatReactions.set(messageId, msgMap);
        }

        let emojiMap = msgMap.get(emoji);
        if (!emojiMap) {
          emojiMap = new Y.Map<number>();
          msgMap.set(emoji, emojiMap);
        }

        if (emojiMap.has(localPeerId)) {
          // Toggle off
          emojiMap.delete(localPeerId);
          // Cleanup empty maps
          if (emojiMap.size === 0) msgMap.delete(emoji);
          if (msgMap.size === 0) chatReactions.delete(messageId);
        } else {
          // Toggle on
          emojiMap.set(localPeerId, 1);
        }
      });
    },
    [doc, chatReactions, localPeerId],
  );

  // Helper: Get user names for a reaction tooltip
  const getUserNamesTooltip = useCallback(
    (userIds: Set<string>) => {
      const names = Array.from(userIds)
        .map((userId) => {
          if (userId === localPeerId) return localName;
          const participant = participants.find((p) => p.peerId === userId);
          return participant?.name || 'Unknown';
        })
        .join(', ');
      return names;
    },
    [localPeerId, localName, participants],
  );

  // Helper: Insert emoji at cursor position in textarea
  const insertEmojiAtCursor = useCallback(
    (emoji: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = input;

      const newText = text.slice(0, start) + emoji + text.slice(end);
      setInput(newText);

      // Restore cursor position after emoji
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
        textarea.focus();
      }, 0);
    },
    [input],
  );

  // Map theme to EmojiPicker theme type
  const emojiTheme: EmojiTheme =
    theme === 'dark' ? EmojiTheme.DARK : EmojiTheme.LIGHT;

  // Sync reactions from Yjs
  useEffect(() => {
    const updateReactions = () => {
      const reactionsData: Record<string, Record<string, Set<string>>> = {};

      chatReactions.forEach((msgMap, messageId) => {
        const emojiData: Record<string, Set<string>> = {};
        msgMap.forEach((emojiMap, emoji) => {
          const userIds = new Set<string>();
          emojiMap.forEach((_, userId) => {
            userIds.add(userId);
          });
          if (userIds.size > 0) {
            emojiData[emoji] = userIds;
          }
        });
        if (Object.keys(emojiData).length > 0) {
          reactionsData[messageId] = emojiData;
        }
      });

      setReactions(reactionsData);
    };

    updateReactions();
    chatReactions.observeDeep(updateReactions);

    return () => {
      chatReactions.unobserveDeep(updateReactions);
    };
  }, [chatReactions]);

  // Unlock AudioContext on user interaction
  useEffect(() => {
    const unlock = () => {
      if (!audioContextRef.current) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          audioContextRef.current = new AudioContext();
        }
      }
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      hasUnlockedAudio.current = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };

    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const playPing = useCallback(() => {
    if (!hasUnlockedAudio.current || !soundEnabledRef.current) return;
    try {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      const t = ctx.currentTime;
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      masterGain.gain.setValueAtTime(0, t);
      // Increased volume and added fade out
      masterGain.gain.linearRampToValueAtTime(0.15, t + 0.01);
      masterGain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);

      // Fundamental tone
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(800, t); // Main pitch
      osc1.connect(masterGain);

      // Harmonic tone (perfect fifth higher) for "bell" character
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1200, t);
      osc2.connect(masterGain);

      osc1.start(t);
      osc2.start(t);

      // Stop after decay
      osc1.stop(t + 0.9);
      osc2.stop(t + 1.5);

      // Cleanup to prevent memory leaks in long sessions
      setTimeout(() => {
        masterGain.disconnect();
      }, 1000);
    } catch (err) {
      console.error('Error playing sound:', err);
    }
  }, []);

  // Get Y.Array for chat messages
  const chatArray = doc.getArray<ChatMessage>('chat');

  // Sync messages from Yjs
  useEffect(() => {
    const updateMessages = (event?: Y.YArrayEvent<ChatMessage>) => {
      setMessages(chatArray.toArray());

      // If this update was triggered by an event (not initial load)
      if (event && event.changes.delta) {
        // Check for inserted messages that are NOT from me
        const hasNewIncomingMessage = event.changes.delta.some((item) => {
          if (item.insert && Array.isArray(item.insert)) {
            const insertedMessages = item.insert as ChatMessage[];
            return insertedMessages.some((msg) => msg.name !== localName);
          }
          return false;
        });

        if (hasNewIncomingMessage) {
          playPing();
        }
      }
    };

    updateMessages();
    chatArray.observe(updateMessages);

    return () => {
      chatArray.unobserve(updateMessages);
    };
  }, [chatArray, localName, playPing]);

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

  // Auto-resize textarea based on content
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    const container = chatContainerRef.current;
    if (!textarea || !container) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Calculate max height as 40% of the chat container
    const containerHeight = container.clientHeight;
    const maxHeight = containerHeight * 0.4;

    // Set the height to scrollHeight, capped at maxHeight
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;

    // Enable overflow if content exceeds max height
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  // Adjust height when input changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // Adjust height when container resizes (e.g. sidebar transition)
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      adjustTextareaHeight();
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, [adjustTextareaHeight]);

  return (
    <div
      ref={chatContainerRef}
      className="flex-1 flex flex-col min-h-0 min-w-0 px-4 pb-4"
    >
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

                {/* Reactions row */}
                {reactions[msg.id] &&
                  Object.keys(reactions[msg.id]).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {Object.entries(reactions[msg.id]).map(
                        ([emoji, userIds]) => (
                          <button
                            key={emoji}
                            onClick={() => toggleReaction(msg.id, emoji)}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                              userIds.has(localPeerId)
                                ? 'bg-primary/10 border-primary text-primary'
                                : 'bg-panel-2 border-border text-text-muted hover:border-primary/50'
                            }`}
                            aria-label={`${emoji} ${userIds.size} reaction${userIds.size > 1 ? 's' : ''}`}
                            title={getUserNamesTooltip(userIds)}
                          >
                            <span>{emoji}</span>
                            <span className="text-[10px] font-medium">
                              {userIds.size}
                            </span>
                          </button>
                        ),
                      )}

                      {/* Add reaction button */}
                      <Popover
                        open={reactionPickerOpen === msg.id}
                        onOpenChange={(open) =>
                          setReactionPickerOpen(open ? msg.id : null)
                        }
                      >
                        <PopoverTrigger asChild>
                          <button
                            className="flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-border
                                     hover:border-primary text-text-muted hover:text-primary transition-colors
                                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label="Add reaction"
                          >
                            <Smile className="w-3 h-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          {/* Quick reactions */}
                          <div className="flex gap-1 p-2 border-b border-border">
                            {['👍', '❤️', '😂', '🎉', '😮', '👀'].map(
                              (emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => {
                                    toggleReaction(msg.id, emoji);
                                    setReactionPickerOpen(null);
                                  }}
                                  className="text-xl hover:bg-panel-2 rounded p-1 transition-colors"
                                  type="button"
                                >
                                  {emoji}
                                </button>
                              ),
                            )}
                          </div>
                          {/* Emoji picker */}
                          <EmojiPicker
                            onEmojiClick={(emojiData) => {
                              toggleReaction(msg.id, emojiData.emoji);
                              setReactionPickerOpen(null);
                            }}
                            theme={emojiTheme}
                            width={320}
                            height={400}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input form - fixed at bottom */}
      <form
        className="flex gap-2 mt-3 shrink-0 items-end"
        onSubmit={handleSend}
      >
        <textarea
          ref={textareaRef}
          className="flex-1 min-w-0 bg-panel-2 border border-border rounded-lg px-3 py-2 text-sm text-text
                     placeholder:text-text-muted resize-none overflow-hidden
                     focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary
                     transition-colors leading-5"
          style={{ minHeight: '38px' }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          maxLength={2000}
          rows={1}
        />

        {/* Emoji picker button */}
        <Popover
          open={inputEmojiPickerOpen}
          onOpenChange={setInputEmojiPickerOpen}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg
                         border border-border text-text-muted hover:text-primary hover:border-primary
                         transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Insert emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end" side="top">
            <EmojiPicker
              onEmojiClick={(emojiData) => {
                insertEmojiAtCursor(emojiData.emoji);
                setInputEmojiPickerOpen(false);
              }}
              theme={emojiTheme}
              width={320}
              height={400}
            />
          </PopoverContent>
        </Popover>

        <button
          type="submit"
          className="shrink-0 bg-primary text-white px-4 h-9.5 text-sm font-medium rounded-lg
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
