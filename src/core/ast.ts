export interface Located { line: number }
export type Expr = Located & (
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'variable'; name: string }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'index'; name: string; index: Expr }
  | { kind: 'parallel'; branches: Expr[] }
);
export type Stmt = Located & (
  | { kind: 'let'; name: string; size?: number; value?: Expr }
  | { kind: 'assign'; target: Expr; value: Expr }
  | { kind: 'if'; condition: Expr; then: Stmt[]; otherwise: Stmt[] }
  | { kind: 'while'; condition: Expr; body: Stmt[] }
  | { kind: 'return'; value: Expr }
  | { kind: 'expr'; expression: Expr }
  | { kind: 'parallelLet'; names: string[]; branches: Expr[] }
);
export interface FunctionDecl extends Located { name: string; params: string[]; body: Stmt[]; recursive: boolean }
export interface Program { functions: FunctionDecl[] }
