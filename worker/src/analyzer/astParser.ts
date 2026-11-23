import ts from "typescript";
import path from "node:path";

export type ImportEntry = {
  source: string;
  specifiers: string[];
  defaultImport?: string;
};

export type ExportEntry = {
  name: string;
  isDefault?: boolean;
};

export type SymbolEntry = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "component";
  isExported: boolean;
};

export type AstSummary = {
  imports: ImportEntry[];
  exports: ExportEntry[];
  symbols: SymbolEntry[];
};

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

export function parseSource(filePath: string, content: string): AstSummary {
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const imports: ImportEntry[] = [];
  const exports: ExportEntry[] = [];
  const symbols: SymbolEntry[] = [];

  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      const sourceText = (node.moduleSpecifier as ts.StringLiteral).text;
      const entry: ImportEntry = { source: sourceText, specifiers: [] };
      if (node.importClause?.name) {
        entry.defaultImport = node.importClause.name.text;
      }
      if (node.importClause?.namedBindings) {
        if (ts.isNamedImports(node.importClause.namedBindings)) {
          entry.specifiers = node.importClause.namedBindings.elements.map((el) => el.name.text);
        }
      }
      imports.push(entry);
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      node.exportClause.elements.forEach((el) => {
        exports.push({ name: el.name.text, isDefault: false });
      });
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      symbols.push({
        name,
        kind: isComponentName(name) ? "component" : "function",
        isExported: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false,
      });
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exports.push({ name, isDefault: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) });
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      symbols.push({
        name,
        kind: "class",
        isExported: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false,
      });
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exports.push({ name, isDefault: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) });
      }
    }

    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      symbols.push({ name, kind: "interface", isExported: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false });
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exports.push({ name });
      }
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      symbols.push({ name, kind: "type", isExported: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false });
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exports.push({ name });
      }
    }

    if (ts.isVariableStatement(node)) {
      const isExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      node.declarationList.declarations.forEach((decl) => {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          const isComponent =
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
            isComponentName(name);
          if (isComponent) {
            symbols.push({ name, kind: "component", isExported: !!isExport });
            if (isExport) exports.push({ name });
          }
        }
      });
    }
  });

  return { imports, exports, symbols };
}
