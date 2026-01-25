import { useEffect, useRef, useState, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import * as Y from 'yjs';

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'sql', label: 'SQL' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
];

export function CodeEditor() {
  const { doc } = useSession();
  const { isDark } = useTheme();
  const [language, setLanguage] = useState('javascript');
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const isRemoteChange = useRef(false);
  const isLocalChange = useRef(false);

  // Get Y.Text for code
  const yText = doc.getText('code');

  // Update ref in effect, not during render
  useEffect(() => {
    yTextRef.current = yText;
  }, [yText]);

  // Sync Monaco content to Yjs
  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;

    // Initialize editor with current Yjs content
    const content = yText.toString();
    if (content) {
      isRemoteChange.current = true;
      editor.setValue(content);
      isRemoteChange.current = false;
    }

    // Listen for local changes
    editor.onDidChangeModelContent(
      (event: Monaco.editor.IModelContentChangedEvent) => {
        if (isRemoteChange.current) return;
        isLocalChange.current = true;

        doc.transact(() => {
          for (const change of event.changes) {
            // Delete text
            if (change.rangeLength > 0) {
              yText.delete(change.rangeOffset, change.rangeLength);
            }
            // Insert text
            if (change.text) {
              yText.insert(change.rangeOffset, change.text);
            }
          }
        });

        isLocalChange.current = false;
      },
    );
  };

  // Subscribe to Yjs changes
  useEffect(() => {
    const observer = (event: Y.YTextEvent) => {
      if (isLocalChange.current) return;
      if (!editorRef.current) return;

      isRemoteChange.current = true;
      const editor = editorRef.current;
      const model = editor.getModel();

      if (!model) {
        isRemoteChange.current = false;
        return;
      }

      // Apply each delta
      let index = 0;
      for (const delta of event.delta) {
        if (delta.retain !== undefined) {
          index += delta.retain;
        } else if (
          delta.insert !== undefined &&
          typeof delta.insert === 'string'
        ) {
          const pos = model.getPositionAt(index);
          editor.executeEdits('yjs', [
            {
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              },
              text: delta.insert,
            },
          ]);
          index += delta.insert.length;
        } else if (delta.delete !== undefined) {
          const startPos = model.getPositionAt(index);
          const endPos = model.getPositionAt(index + delta.delete);
          editor.executeEdits('yjs', [
            {
              range: {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
              },
              text: '',
            },
          ]);
        }
      }

      isRemoteChange.current = false;
    };

    yText.observe(observer);
    return () => yText.unobserve(observer);
  }, [yText]);

  // Reset code
  const handleReset = useCallback(() => {
    if (
      confirm(
        'Are you sure you want to clear all code? This affects all participants.',
      )
    ) {
      doc.transact(() => {
        yText.delete(0, yText.length);
      });
    }
  }, [doc, yText]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-panel border-b border-border">
        <label htmlFor="language-select" className="text-xs text-text-muted">
          Language:
        </label>
        <select
          id="language-select"
          className="bg-panel-2 border border-border text-text px-3 py-1.5 rounded-md text-sm
                     cursor-pointer focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary
                     transition-colors"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.id} value={lang.id}>
              {lang.label}
            </option>
          ))}
        </select>
        <button
          className="ml-auto bg-danger/15 border border-danger/30 text-danger px-3 py-1.5 text-xs rounded-md
                     hover:bg-danger/25 hover:border-danger/50 transition-colors
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          onClick={handleReset}
        >
          Reset Code
        </button>
      </div>

      {/* Editor container */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={language}
          theme={isDark ? 'vs-dark' : 'light'}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, monospace',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}
