import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { formatWithPrettier } from '../lib/format';
import * as Y from 'yjs';
import { Button } from './ui/button';
import { RotateCcw, Copy, Check } from 'lucide-react';
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
import { Switch } from './ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'javascriptreact', label: 'JavaScript React' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'typescriptreact', label: 'TypeScript React' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'sql', label: 'SQL' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
];

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  javascriptreact: 'jsx',
  typescript: 'ts',
  typescriptreact: 'tsx',
  python: 'py',
  java: 'java',
  csharp: 'cs',
  go: 'go',
  sql: 'sql',
  html: 'html',
  css: 'css',
  json: 'json',
};

function addFormatOnSave(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  checkEnabled: () => boolean,
) {
  const runFormat = async () => {
    if (!checkEnabled()) return;
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
  const [isFormatterEnabled, setIsFormatterEnabled] = useState(true);
  const [isStrictMode, setIsStrictMode] = useState(true);
  const isFormatterEnabledRef = useRef(isFormatterEnabled);

  useEffect(() => {
    isFormatterEnabledRef.current = isFormatterEnabled;
  }, [isFormatterEnabled]);

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

    // Define custom dark theme
    monaco.editor.defineTheme('code-share-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#111827',
      },
    });

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
        // Add minimal types for common hooks
        function useCallback<T extends (...args: any[]) => any>(callback: T, deps: ReadonlyArray<any>): T;
        function useMemo<T>(factory: () => T, deps: ReadonlyArray<any> | undefined): T;
        function useContext<T>(context: React.Context<T>): T;
        function useReducer<R, I>(reducer: (prevState: R, action: any) => R, initializerArg: I, initializer?: (arg: I) => R): [R, React.Dispatch<any>];
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
      addFormatOnSave(editor, monaco, () => isFormatterEnabledRef.current);
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

      console.log('[CodeEditor] Remote change detected', event.delta);

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

  // Handle remote document updates (including full state sync from late-joiner)
  useEffect(() => {
    const handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
      // Only handle remote updates (from peers)
      if (origin !== 'remote') return;

      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;

      // Get the current Yjs content and editor content
      const yjsContent = yText.toString();
      const editorContent = model.getValue();

      // If they differ, update the editor (this handles full state sync)
      if (yjsContent !== editorContent) {
        console.log(
          '[CodeEditor] Remote sync detected, refreshing editor content',
        );
        isRemoteChange.current = true;
        editor.setValue(yjsContent);
        isRemoteChange.current = false;
      }
    };

    doc.on('update', handleDocUpdate);
    return () => doc.off('update', handleDocUpdate);
  }, [doc, yText]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    const options = {
      noSemanticValidation: !isStrictMode,
      noSyntaxValidation: !isStrictMode,
    };

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(
      options,
    );
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
      options,
    );
  }, [isStrictMode]);

  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Copy code to clipboard
  const handleCopy = useCallback(async () => {
    const code = yText.toString();
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [yText]);

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
      <div className="flex flex-wrap items-center gap-2 px-2 sm:px-4 py-2 bg-panel border-b border-border min-w-0">
        {/* Language selector */}
        <div className="flex items-center gap-2 min-w-0">
          <label
            htmlFor="language-select"
            className="text-xs text-text-muted hidden sm:inline text-nowrap shrink-0"
          >
            Language:
          </label>
          <Select
            value={language}
            onValueChange={(value) => {
              setLanguage(value);
              if (settings.get('language') !== value) {
                settings.set('language', value);
              }
            }}
          >
            <SelectTrigger className="w-28 sm:w-35 h-8 bg-panel-2 border-border text-text text-xs sm:text-sm">
              <SelectValue placeholder="Select Language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.id} value={lang.id}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="h-6 w-px bg-border hidden sm:block" />

          <div
            className="flex items-center gap-1.5 sm:gap-2"
            title="Enable Prettier formatting on save (Ctrl+S)"
          >
            <label
              htmlFor="format-toggle"
              className="text-xs text-text-muted hidden sm:inline cursor-pointer select-none"
            >
              Prettier
            </label>
            <Switch
              id="format-toggle"
              checked={isFormatterEnabled}
              onCheckedChange={setIsFormatterEnabled}
            />
          </div>

          <div className="h-6 w-px bg-border hidden sm:block" />

          <div
            className="flex items-center gap-1.5 sm:gap-2"
            title="Toggle Strict Mode (Enable/Disable Diagnostics)"
          >
            <label
              htmlFor="strict-mode-toggle"
              className="text-xs text-text-muted hidden sm:inline cursor-pointer select-none"
            >
              Strict
            </label>
            <Switch
              id="strict-mode-toggle"
              checked={isStrictMode}
              onCheckedChange={setIsStrictMode}
            />
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1 min-w-2" />

        {/* Copy and Reset */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={handleCopy}
            title="Copy Code"
          >
            {copied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>

          <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-danger border-border hover:bg-danger/10 hover:text-danger hover:border-danger gap-2 px-2 sm:px-3"
                title="Reset Code"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Reset</span>
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
      </div>

      {/* Editor container */}
      <div className="flex-1 min-h-0 ">
        <Editor
          key={language}
          height="100%"
          language={
            language === 'typescriptreact'
              ? 'typescript'
              : language === 'javascriptreact'
                ? 'javascript'
                : language
          }
          path={`file:///code.${LANGUAGE_EXTENSIONS[language] ?? 'txt'}`}
          defaultPath="file:///code.js"
          theme={isDark ? 'code-share-dark' : 'light'}
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
