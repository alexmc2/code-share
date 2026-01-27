import prettier from 'prettier/standalone';
import type { BuiltInParserName } from 'prettier';
import babel from 'prettier/plugins/babel';
import estree from 'prettier/plugins/estree';
import typescript from 'prettier/plugins/typescript';
import postcss from 'prettier/plugins/postcss';
import html from 'prettier/plugins/html';

type MonacoLang =
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'css'
  | 'scss'
  | 'less'
  | 'html'
  | 'markdown'
  | string;

function monacoToPrettierParser(lang: MonacoLang): BuiltInParserName | null {
  switch (lang) {
    case 'javascript':
    case 'javascriptreact':
      return 'babel';
    case 'typescript':
    case 'typescriptreact':
      return 'typescript';
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'html':
      return 'html';
    case 'markdown':
      return 'markdown';
    default:
      return null;
  }
}

export async function formatWithPrettier(code: string, lang: MonacoLang) {
  const parser = monacoToPrettierParser(lang);
  if (!parser) return { ok: false as const, code };

  try {
    const formatted = await prettier.format(code, {
      parser,
      plugins: [babel, estree, typescript, postcss, html],
      singleQuote: false,
      semi: true,
      trailingComma: 'es5',
      printWidth: 100,
      tabWidth: 2,
    });

    return { ok: true as const, code: formatted };
  } catch {
    return { ok: false as const, code };
  }
}
