import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { debugLog } from '../lib/debug';
import { nanoid } from 'nanoid';
import { Copy, Check, Trash2, Smile, Plus } from 'lucide-react';
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
import { ToolbarTooltip } from './ui/toolbar-tooltip';
import * as Y from 'yjs';

interface ChatMessage {
  id: string;
  ts: number;
  name: string;
  text: string;
}

const RECENT_MESSAGE_WINDOW_MS = 5000;
const EMOJI_PICKER_MAX_WIDTH = 320;
const EMOJI_PICKER_MAX_HEIGHT = 400;
const EMOJI_PICKER_MIN_WIDTH = 220;
const EMOJI_PICKER_MIN_HEIGHT = 240;
const EMOJI_PICKER_VIEWPORT_PADDING = 24;
const EMOJI_PICKER_VIEWPORT_VERTICAL_PADDING = 140;
const TOOLBAR_POPOVER_CHROME_CLASS =
  'rounded-lg border border-slate-200 bg-white text-slate-700 shadow-[0_4px_16px_rgba(15,23,42,0.08)] dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-100 dark:shadow-[0_12px_22px_rgba(2,6,23,0.45)]';

// Escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Memoized message row component to prevent unnecessary re-renders
interface MessageRowProps {
  msg: ChatMessage;
  isOwn: boolean;
  localName: string;
  localPeerId: string;
  reactions: Record<string, Set<string>>;
  copiedId: string | null;
  reactionPickerOpen: string | null;
  fullPickerOpen: string | null;
  emojiTheme: EmojiTheme;
  emojiPickerWidth: number;
  emojiPickerHeight: number;
  onCopy: (msg: ChatMessage) => void;
  onDelete: (msg: ChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onSetReactionPickerOpen: (id: string | null) => void;
  onSetFullPickerOpen: (id: string | null) => void;
  getUserNamesTooltip: (userIds: Set<string>) => string;
}

function MessageRow({
  msg,
  isOwn,
  reactions,
  copiedId,
  reactionPickerOpen,
  fullPickerOpen,
  emojiTheme,
  emojiPickerWidth,
  emojiPickerHeight,
  onCopy,
  onDelete,
  onToggleReaction,
  onSetReactionPickerOpen,
  onSetFullPickerOpen,
  getUserNamesTooltip,
  localPeerId,
}: MessageRowProps) {
  return (
    <div className="group relative bg-panel-2 rounded-lg px-3 py-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold text-primary">
          {escapeHtml(msg.name)}
        </span>
        <div className="flex items-center gap-1">
          {/* Reaction button - always visible on mobile, hover on desktop */}
          <Popover
            open={reactionPickerOpen === msg.id}
            onOpenChange={(open) => {
              onSetReactionPickerOpen(open ? msg.id : null);
              if (!open) onSetFullPickerOpen(null);
            }}
          >
            <ToolbarTooltip label="Add reaction" align="end">
              <PopoverTrigger asChild>
                <button
                  className="copy-btn w-7 h-7 sm:w-5 sm:h-5 flex items-center justify-center rounded text-text-muted
                           hover:text-text hover:bg-panel transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Add reaction"
                >
                  <Smile className="w-4 h-4 sm:w-3 sm:h-3" />
                </button>
              </PopoverTrigger>
            </ToolbarTooltip>
            <PopoverContent
              className={`w-auto max-w-[calc(100vw-1rem)] p-0 overflow-hidden ${TOOLBAR_POPOVER_CHROME_CLASS}`}
              align="end"
              side="top"
              sideOffset={10}
              collisionPadding={12}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {fullPickerOpen === msg.id ? (
                /* Full emoji picker - only render when actually open */
                <div className="relative">
                  <button
                    onClick={() => onSetFullPickerOpen(null)}
                    className="absolute top-2 left-2 z-10 w-6 h-6 flex items-center justify-center
                             bg-panel-2 hover:bg-panel rounded text-text-muted hover:text-text
                             transition-colors"
                    aria-label="Back to quick reactions"
                  >
                    ←
                  </button>
                  <EmojiPicker
                    onEmojiClick={(emojiData) => {
                      onToggleReaction(msg.id, emojiData.emoji);
                      onSetReactionPickerOpen(null);
                      onSetFullPickerOpen(null);
                    }}
                    theme={emojiTheme}
                    width={emojiPickerWidth}
                    height={emojiPickerHeight}
                  />
                </div>
              ) : (
                /* Quick reactions bar */
                <div className="flex gap-1 p-2">
                  {['👍', '❤️', '🙏', '😭', '😂', '🤬'].map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        onToggleReaction(msg.id, emoji);
                        onSetReactionPickerOpen(null);
                      }}
                      className="text-xl hover:bg-panel-2 rounded p-1 transition-colors"
                      type="button"
                      aria-label={`React with ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    onClick={() => onSetFullPickerOpen(msg.id)}
                    className="w-8 h-8 flex items-center justify-center rounded border border-dashed
                             border-border hover:border-primary text-text-muted hover:text-primary
                             transition-colors"
                    type="button"
                    aria-label="More emojis"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </PopoverContent>
          </Popover>

          <ToolbarTooltip label="Copy message" align="end">
            <button
              className="copy-btn w-7 h-7 sm:w-5 sm:h-5 flex items-center justify-center rounded text-text-muted
                       hover:text-text hover:bg-panel transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => onCopy(msg)}
              aria-label="Copy message"
            >
              {copiedId === msg.id ? (
                <Check className="w-4 h-4 sm:w-3 sm:h-3 text-success" />
              ) : (
                <Copy className="w-4 h-4 sm:w-3 sm:h-3" />
              )}
            </button>
          </ToolbarTooltip>
          {isOwn && (
            <ToolbarTooltip label="Delete message" align="end">
              <button
                className="copy-btn w-7 h-7 sm:w-5 sm:h-5 flex items-center justify-center rounded text-text-muted
                         hover:text-danger hover:bg-danger/10 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                onClick={() => onDelete(msg)}
                aria-label="Delete message"
              >
                <Trash2 className="w-4 h-4 sm:w-3 sm:h-3" />
              </button>
            </ToolbarTooltip>
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

      {/* Reactions row -*/}
      {reactions && Object.keys(reactions).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {Object.entries(reactions).map(([emoji, userIds]) => {
            const hasReacted = userIds.has(localPeerId);
            const tooltip = getUserNamesTooltip(userIds);
            return (
              <ToolbarTooltip key={emoji} label={tooltip} align="start">
                <button
                  onClick={() => onToggleReaction(msg.id, emoji)}
                  className={`reaction-pill-bg flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                    hasReacted
                      ? 'border-slate-400/40 text-text ring-0.5 ring-slate-50 dark:ring-slate-500/50'
                      : 'border-slate-300/20 dark:border-slate-600/30 text-text-muted hover:border-slate-400/50 dark:hover:border-slate-500/40'
                  }`}
                  aria-label={`${emoji} ${userIds.size} reaction${userIds.size > 1 ? 's' : ''}${hasReacted ? ', you reacted' : ''}`}
                >
                  <span className="text-[14px]">{emoji}</span>
                  <span className="text-[12px] font-medium">
                    {userIds.size}
                  </span>
                </button>
              </ToolbarTooltip>
            );
          })}
        </div>
      )}
    </div>
  );
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

  // Stable empty object to prevent memo breaking
  const EMPTY_REACTIONS = useMemo<Record<string, Set<string>>>(() => ({}), []);
  const [reactionPickerOpen, setReactionPickerOpen] = useState<string | null>(
    null,
  );
  const [fullPickerOpen, setFullPickerOpen] = useState<string | null>(null);
  const [inputEmojiPickerOpen, setInputEmojiPickerOpen] = useState(false);
  const [emojiPickerSize, setEmojiPickerSize] = useState({
    width: EMOJI_PICKER_MAX_WIDTH,
    height: EMOJI_PICKER_MAX_HEIGHT,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasUnlockedAudio = useRef(false);
  const pendingPingRef = useRef(false);
  const unlockListenersAttachedRef = useRef(false);
  const unlockHandlerRef = useRef<((event?: Event) => void) | null>(null);
  const mountedAtRef = useRef<number | null>(null);

  // Update ref when prop changes
  useEffect(() => {
    // console.log('Chat: soundEnabled prop changed to', soundEnabled);
    soundEnabledRef.current = soundEnabled;
    if (!soundEnabled) {
      pendingPingRef.current = false;
      debugLog('ping', 'Sound disabled, cleared pending ping');
    }
  }, [soundEnabled]);

  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  // Debug log for ping
  // console.log('Chat: render, soundEnabled=', soundEnabled);

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

  useEffect(() => {
    const updateEmojiPickerSize = () => {
      const width = Math.max(
        EMOJI_PICKER_MIN_WIDTH,
        Math.min(
          EMOJI_PICKER_MAX_WIDTH,
          window.innerWidth - EMOJI_PICKER_VIEWPORT_PADDING,
        ),
      );
      const height = Math.max(
        EMOJI_PICKER_MIN_HEIGHT,
        Math.min(
          EMOJI_PICKER_MAX_HEIGHT,
          window.innerHeight - EMOJI_PICKER_VIEWPORT_VERTICAL_PADDING,
        ),
      );
      setEmojiPickerSize({ width, height });
    };

    updateEmojiPickerSize();
    window.addEventListener('resize', updateEmojiPickerSize);

    return () => {
      window.removeEventListener('resize', updateEmojiPickerSize);
    };
  }, []);

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

  // Cleanup orphaned reactions (when messages are deleted)
  useEffect(() => {
    const validMessageIds = new Set(messages.map((m) => m.id));
    const orphanedIds: string[] = [];

    chatReactions.forEach((_, messageId) => {
      if (!validMessageIds.has(messageId)) {
        orphanedIds.push(messageId);
      }
    });

    if (orphanedIds.length > 0) {
      doc.transact(() => {
        orphanedIds.forEach((id) => chatReactions.delete(id));
      });
    }
  }, [messages, chatReactions, doc]);

  const playPingTone = useCallback((ctx: AudioContext) => {
    const t = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.setValueAtTime(0, t);
    masterGain.gain.linearRampToValueAtTime(0.15, t + 0.01);
    masterGain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(800, t);
    osc1.connect(masterGain);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1200, t);
    osc2.connect(masterGain);

    osc1.start(t);
    osc2.start(t);

    const stopTime = t + 1.2;
    osc1.stop(stopTime);
    osc2.stop(stopTime + 0.2);

    const cleanupDelay = Math.max(0, (stopTime + 0.3 - ctx.currentTime) * 1000);
    setTimeout(() => {
      try {
        osc1.disconnect();
        osc2.disconnect();
        masterGain.disconnect();
      } catch {
        // Ignore disconnect errors on teardown
      }
    }, cleanupDelay);
  }, []);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (audioContextRef.current?.state === 'closed') {
      audioContextRef.current = null;
      hasUnlockedAudio.current = false;
    }
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return null;
      audioContextRef.current = new AudioContextCtor();
      debugLog('ping', 'AudioContext created', audioContextRef.current.state);
    }
    return audioContextRef.current;
  }, []);

  const resumeAudioContext = useCallback(async (ctx: AudioContext) => {
    if (ctx.state === 'closed') return false;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch (err) {
        debugLog('ping', 'AudioContext resume failed', err);
        return false;
      }
    }
    return ctx.state === 'running';
  }, []);

  const removeUnlockListeners = useCallback(() => {
    if (!unlockListenersAttachedRef.current) return;
    const handler = unlockHandlerRef.current;
    if (handler) {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    }
    unlockListenersAttachedRef.current = false;
    debugLog('ping', 'Unlock listeners removed');
  }, []);

  const unlockAudioFromGesture = useCallback(async () => {
    const ctx = ensureAudioContext();
    debugLog('ping', 'Unlock gesture', {
      soundEnabled: soundEnabledRef.current,
      hasUnlocked: hasUnlockedAudio.current,
      ctxExists: !!ctx,
      ctxState: ctx?.state,
      pending: pendingPingRef.current,
    });

    if (!ctx) return;

    const resumed = await resumeAudioContext(ctx);
    if (!resumed) return;

    hasUnlockedAudio.current = true;

    if (pendingPingRef.current) {
      if (soundEnabledRef.current) {
        pendingPingRef.current = false;
        playPingTone(ctx);
      } else {
        pendingPingRef.current = false;
      }
    }

    if (!pendingPingRef.current) {
      removeUnlockListeners();
    }
  }, [
    ensureAudioContext,
    resumeAudioContext,
    playPingTone,
    removeUnlockListeners,
  ]);

  const attachUnlockListeners = useCallback(() => {
    if (unlockListenersAttachedRef.current) return;
    const handler = unlockHandlerRef.current || unlockAudioFromGesture;
    unlockHandlerRef.current = handler;
    window.addEventListener('pointerdown', handler, {
      passive: true,
    });
    window.addEventListener('keydown', handler);
    unlockListenersAttachedRef.current = true;
    debugLog('ping', 'Unlock listeners attached');
  }, [unlockAudioFromGesture]);

  // Unlock AudioContext on user interaction
  useEffect(() => {
    attachUnlockListeners();
    return () => {
      removeUnlockListeners();
    };
  }, [attachUnlockListeners, removeUnlockListeners]);

  const playPing = useCallback(async () => {
    debugLog('ping', 'Ping requested', {
      soundEnabled: soundEnabledRef.current,
      hasUnlocked: hasUnlockedAudio.current,
      ctxExists: !!audioContextRef.current,
      ctxState: audioContextRef.current?.state,
      pending: pendingPingRef.current,
    });

    if (!soundEnabledRef.current) {
      pendingPingRef.current = false;
      return;
    }

    if (!hasUnlockedAudio.current) {
      pendingPingRef.current = true;
      attachUnlockListeners();
      debugLog('ping', 'Queued ping: audio not unlocked');
      return;
    }

    const ctx = ensureAudioContext();
    if (!ctx) return;

    if (ctx.state === 'closed') {
      audioContextRef.current = null;
      hasUnlockedAudio.current = false;
      pendingPingRef.current = true;
      attachUnlockListeners();
      debugLog('ping', 'AudioContext closed, queued ping');
      return;
    }

    const resumed = await resumeAudioContext(ctx);
    if (!resumed) {
      hasUnlockedAudio.current = false;
      pendingPingRef.current = true;
      attachUnlockListeners();
      debugLog('ping', 'Resume blocked, queued ping');
      return;
    }

    pendingPingRef.current = false;
    playPingTone(ctx);
  }, [
    attachUnlockListeners,
    ensureAudioContext,
    resumeAudioContext,
    playPingTone,
  ]);

  // Get Y.Array for chat messages
  const chatArray = doc.getArray<ChatMessage>('chat');

  // Sync messages from Yjs
  useEffect(() => {
    const updateMessages = (event?: Y.YArrayEvent<ChatMessage>) => {
      const nextMessages = chatArray.toArray();
      setMessages(nextMessages);

      if (!event || !event.changes.delta) {
        debugLog('ping', 'Chat sync (no event)', {
          count: nextMessages.length,
        });
        return;
      }

      debugLog('ping', 'Chat delta', {
        local: event.transaction.local,
        delta: event.changes.delta,
      });

      if (event.transaction.local) return;

      if (mountedAtRef.current === null) {
        mountedAtRef.current = Date.now();
      }

      const insertedMessages: ChatMessage[] = [];
      event.changes.delta.forEach((item) => {
        if (item.insert && Array.isArray(item.insert)) {
          insertedMessages.push(...(item.insert as ChatMessage[]));
        }
      });

      if (insertedMessages.length === 0) return;

      const incomingMessages = insertedMessages.filter(
        (msg) => msg.name !== localName,
      );
      const mountedAt = mountedAtRef.current ?? Date.now();
      const recentIncoming = incomingMessages.filter(
        (msg) => msg.ts >= mountedAt - RECENT_MESSAGE_WINDOW_MS,
      );

      debugLog('ping', 'Chat inserts', {
        inserted: insertedMessages.length,
        incoming: incomingMessages.length,
        recentIncoming: recentIncoming.length,
        mountedAt,
      });

      if (recentIncoming.length > 0) {
        playPing();
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
        // Delete the message
        chatArray.delete(index, 1);
        // Also delete its reactions to avoid orphaned data
        if (chatReactions.has(messageToDelete.id)) {
          chatReactions.delete(messageToDelete.id);
        }
      });
    }
    setMessageToDelete(null);
  }, [chatArray, chatReactions, doc, localName, messageToDelete]);

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
            const msgReactions = reactions[msg.id] || EMPTY_REACTIONS;
            return (
              <MessageRow
                key={msg.id}
                msg={msg}
                isOwn={isOwn}
                localName={localName}
                localPeerId={localPeerId}
                reactions={msgReactions}
                copiedId={copiedId}
                reactionPickerOpen={reactionPickerOpen}
                fullPickerOpen={fullPickerOpen}
                emojiTheme={emojiTheme}
                emojiPickerWidth={emojiPickerSize.width}
                emojiPickerHeight={emojiPickerSize.height}
                onCopy={handleCopy}
                onDelete={setMessageToDelete}
                onToggleReaction={toggleReaction}
                onSetReactionPickerOpen={setReactionPickerOpen}
                onSetFullPickerOpen={setFullPickerOpen}
                getUserNamesTooltip={getUserNamesTooltip}
              />
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
          <PopoverContent
            className={`w-auto max-w-[calc(100vw-1rem)] p-0 overflow-hidden ${TOOLBAR_POPOVER_CHROME_CLASS}`}
            align="end"
            side="top"
            sideOffset={10}
            collisionPadding={12}
          >
            {inputEmojiPickerOpen && (
              <EmojiPicker
                onEmojiClick={(emojiData) => {
                  insertEmojiAtCursor(emojiData.emoji);
                  setInputEmojiPickerOpen(false);
                }}
                theme={emojiTheme}
                width={emojiPickerSize.width}
                height={emojiPickerSize.height}
              />
            )}
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
