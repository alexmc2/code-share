import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { formatWithPrettier } from '../lib/format';
import * as Y from 'yjs';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from './ui/dialog';

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

const LANGUAGE_PATHS: Record<string, string> = {
  javascript: 'file:///main.jsx',
  typescript: 'file:///main.tsx',
  python: 'file:///main.py',
  java: 'file:///main.java',
  csharp: 'file:///main.cs',
  go: 'file:///main.go',
  sql: 'file:///main.sql',
  html: 'file:///main.html',
  css: 'file:///main.css',
  json: 'file:///main.json',
};

function languageToPath(lang: string) {
  return LANGUAGE_PATHS[lang] ?? 'file:///main.txt';
}

function addFormatOnSave(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
) {
  const runFormat = async () => {
    const model = editor.getModel();
    if (!model) return;

    const lang = model.getLanguageId();
    const original = model.getValue();

    const res = await formatWithPrettier(original, lang);
    if (!res.ok) {
      await editor.getAction('editor.action.formatDocument')?.run();
      return;
    }

    if (res.code === original) return;

    const selections = editor.getSelections() ?? [];
    model.pushEditOperations(
      selections,
      [{ range: model.getFullModelRange(), text: res.code }],
      () => selections,
    );
  };

  editor.addAction({
    id: 'format-with-prettier',
    label: 'Format (Prettier)',
    run: runFormat,
  });

  editor.onKeyDown((e) => {
    const isSave =
      (e.ctrlKey || e.metaKey) && e.keyCode === monaco.KeyCode.KeyS;
    if (!isSave) return;

    e.preventDefault();
    void runFormat();
  });
}

export function CodeEditor() {
  const { doc } = useSession();
  const { isDark } = useTheme();
  const settings = useMemo(() => doc.getMap('settings'), [doc]);
  const [language, setLanguage] = useState(() => {
    const stored = settings.get('language');
    return typeof stored === 'string' ? stored : 'javascript';
  });
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const isRemoteChange = useRef(false);
  const isLocalChange = useRef(false);

  // Get Y.Text for code
  const yText = doc.getText('code');

  // Update ref in effect, not during render
  useEffect(() => {
    yTextRef.current = yText;
  }, [yText]);

  // Configure Monaco for React
  const handleBeforeMount: BeforeMount = (monaco) => {
    const compilerOptions = {
      target: monaco.languages.typescript.ScriptTarget.ES2015,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: true,
      typeRoots: ['node_modules/@types'],
    };

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
      compilerOptions,
    );
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
      compilerOptions,
    );

    // Add React type definitions
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `
      declare module 'react' {
        export = React;
      }
      declare namespace React {
        interface Component<P = {}, S = {}, SS = any> {}
        function useState<T>(initialState: T | (() => T)): [T, (newState: T | ((prevState: T) => T)) => void];
        function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<any>): void;
        function useRef<T>(initialValue: T): { current: T };
        // Add more basic React types as needed for basic autocompletion
      }
      `,
      'file:///node_modules/@types/react/index.d.ts',
    );
  };

  // Sync Monaco content to Yjs
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    if (monaco) {
      addFormatOnSave(editor, monaco);
    }

    // Initialize editor with current Yjs content
    const content = yTextRef.current?.toString() ?? '';
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

  useEffect(() => {
    const updateLanguage = () => {
      const stored = settings.get('language');
      if (typeof stored === 'string' && stored !== language) {
        setLanguage(stored);
      }
    };

    updateLanguage();
    const observer = () => updateLanguage();
    settings.observe(observer);
    return () => settings.unobserve(observer);
  }, [settings, language]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;

    monaco.editor.setModelLanguage(model, language);
    const content = yText.toString();
    if (model.getValue() !== content) {
      isRemoteChange.current = true;
      editor.setValue(content);
      isRemoteChange.current = false;
    }
  }, [language, yText]);

  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);

  // Reset code
  const handleReset = useCallback(() => {
    doc.transact(() => {
      yText.delete(0, yText.length);
    });
    setIsResetDialogOpen(false);
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
          onChange={(e) => {
            const next = e.target.value;
            setLanguage(next);
            if (settings.get('language') !== next) {
              settings.set('language', next);
            }
          }}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.id} value={lang.id}>
              {lang.label}
            </option>
          ))}
        </select>

        <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto text-danger border-border hover:bg-danger/10 hover:text-danger hover:border-danger"
            >
              Reset
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Code?</DialogTitle>
              <DialogDescription>
                Are you sure you want to clear all code? This affects all
                participants and cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button variant="destructive" onClick={handleReset}>
                Reset Code
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Editor container */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={language}
          path={languageToPath(language)}
          theme={isDark ? 'vs-dark' : 'light'}
          onMount={handleEditorMount}
          beforeMount={handleBeforeMount}
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
