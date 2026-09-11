import { CstParser, Lexer, createToken, type CstNode, type IToken } from 'chevrotain';
import type { Expr, FunctionDecl, Program, Stmt } from './core/ast';

const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /\s+/, group: Lexer.SKIPPED });
const Comment = createToken({ name: 'Comment', pattern: /\/\/[^\n\r]*/, group: Lexer.SKIPPED });
const Identifier = createToken({ name: 'Identifier', pattern: /[A-Za-z_][A-Za-z_0-9]*/ });
const keyword = (name: string, text: string) => createToken({ name, pattern: new RegExp(text), longer_alt: Identifier });
const Fn = keyword('Fn', 'fn');
const Rec = keyword('Rec', 'rec');
const Let = keyword('Let', 'let');
const If = keyword('If', 'if');
const Else = keyword('Else', 'else');
const While = keyword('While', 'while');
const Return = keyword('Return', 'return');
const Parallel = keyword('Parallel', 'parallel');
const NumberLiteral = createToken({ name: 'NumberLiteral', pattern: /0|[1-9][0-9]*/ });
const StringLiteral = createToken({ name: 'StringLiteral', pattern: /"(?:[^"\\\r\n]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/ });
const Arrow = createToken({ name: 'Arrow', pattern: /->/ });
const Comparison = createToken({ name: 'Comparison', pattern: /==|!=|<=|>=|<|>/ });
const AddOperator = createToken({ name: 'AddOperator', pattern: /\+|-/ });
const Equals = createToken({ name: 'Equals', pattern: /=/ });
const LParen = createToken({ name: 'LParen', pattern: /\(/ });
const RParen = createToken({ name: 'RParen', pattern: /\)/ });
const LBrace = createToken({ name: 'LBrace', pattern: /\{/ });
const RBrace = createToken({ name: 'RBrace', pattern: /\}/ });
const LBracket = createToken({ name: 'LBracket', pattern: /\[/ });
const RBracket = createToken({ name: 'RBracket', pattern: /\]/ });
const Comma = createToken({ name: 'Comma', pattern: /,/ });
const Colon = createToken({ name: 'Colon', pattern: /:/ });
const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ });
const tokens = [WhiteSpace, Comment, Fn, Rec, Let, If, Else, While, Return, Parallel,
  NumberLiteral, StringLiteral, Identifier, Arrow, Comparison, AddOperator, Equals,
  LParen, RParen, LBrace, RBrace, LBracket, RBracket, Comma, Colon, Semicolon];
const lexer = new Lexer(tokens);

class MatrixParser extends CstParser {
  constructor() { super(tokens); this.performSelfAnalysis(); }

  program = this.RULE('program', () => { this.AT_LEAST_ONE(() => this.SUBRULE(this.functionDecl)); });
  functionDecl = this.RULE('functionDecl', () => {
    this.OPTION(() => this.CONSUME(Rec)); this.CONSUME(Fn); this.CONSUME(Identifier);
    this.CONSUME(LParen);
    this.MANY_SEP({ SEP: Comma, DEF: () => this.SUBRULE(this.parameter) });
    this.CONSUME(RParen);
    this.OPTION2(() => { this.CONSUME(Arrow); this.CONSUME2(Identifier); });
    this.SUBRULE(this.block);
  });
  parameter = this.RULE('parameter', () => {
    this.CONSUME(Identifier); this.OPTION(() => { this.CONSUME(Colon); this.CONSUME2(Identifier); });
  });
  block = this.RULE('block', () => {
    this.CONSUME(LBrace); this.MANY(() => this.SUBRULE(this.statement)); this.CONSUME(RBrace);
  });
  statement = this.RULE('statement', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.letStatement) },
      { ALT: () => this.SUBRULE(this.ifStatement) },
      { ALT: () => this.SUBRULE(this.whileStatement) },
      { ALT: () => this.SUBRULE(this.returnStatement) },
      { ALT: () => this.SUBRULE(this.expressionStatement) },
    ]);
  });
  letStatement = this.RULE('letStatement', () => {
    this.CONSUME(Let);
    this.OR([
      { ALT: () => {
        this.CONSUME(LParen);
        this.AT_LEAST_ONE_SEP({ SEP: Comma, DEF: () => this.CONSUME(Identifier, { LABEL: 'tupleName' }) });
        this.CONSUME(RParen); this.CONSUME(Equals); this.SUBRULE(this.parallelExpression);
      } },
      { ALT: () => {
        this.CONSUME2(Identifier, { LABEL: 'variableName' });
        this.OPTION(() => { this.CONSUME(Colon); this.CONSUME3(Identifier, { LABEL: 'typeName' }); });
        this.OPTION2(() => { this.CONSUME(LBracket); this.CONSUME(NumberLiteral); this.CONSUME(RBracket); });
        this.OPTION3(() => { this.CONSUME2(Equals); this.SUBRULE(this.expression); });
      } },
    ]);
    this.CONSUME(Semicolon);
  });
  ifStatement = this.RULE('ifStatement', () => {
    this.CONSUME(If); this.CONSUME(LParen); this.SUBRULE(this.expression); this.CONSUME(RParen);
    this.SUBRULE(this.block);
    this.OPTION(() => { this.CONSUME(Else); this.SUBRULE2(this.block); });
  });
  whileStatement = this.RULE('whileStatement', () => {
    this.CONSUME(While); this.CONSUME(LParen); this.SUBRULE(this.expression); this.CONSUME(RParen); this.SUBRULE(this.block);
  });
  returnStatement = this.RULE('returnStatement', () => {
    this.CONSUME(Return); this.SUBRULE(this.expression); this.CONSUME(Semicolon);
  });
  expressionStatement = this.RULE('expressionStatement', () => {
    this.SUBRULE(this.expression);
    this.OPTION(() => { this.CONSUME(Equals); this.SUBRULE2(this.expression); });
    this.CONSUME(Semicolon);
  });
  expression = this.RULE('expression', () => {
    this.SUBRULE(this.additive);
    this.MANY(() => { this.CONSUME(Comparison); this.SUBRULE2(this.additive); });
  });
  additive = this.RULE('additive', () => {
    this.SUBRULE(this.primary);
    this.MANY(() => { this.CONSUME(AddOperator); this.SUBRULE2(this.primary); });
  });
  primary = this.RULE('primary', () => {
    this.OR([
      { ALT: () => this.CONSUME(NumberLiteral) },
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.SUBRULE(this.parallelExpression) },
      { ALT: () => {
        this.CONSUME(Identifier);
        this.OPTION(() => this.OR2([
          { ALT: () => {
            this.CONSUME(LParen);
            this.MANY_SEP({ SEP: Comma, DEF: () => this.SUBRULE(this.expression, { LABEL: 'argument' }) });
            this.CONSUME(RParen);
          } },
          { ALT: () => { this.CONSUME(LBracket); this.SUBRULE2(this.expression, { LABEL: 'index' }); this.CONSUME(RBracket); } },
        ]));
      } },
      { ALT: () => { this.CONSUME2(LParen); this.SUBRULE3(this.expression, { LABEL: 'nested' }); this.CONSUME2(RParen); } },
    ]);
  });
  parallelExpression = this.RULE('parallelExpression', () => {
    this.CONSUME(Parallel); this.CONSUME(LBrace);
    this.AT_LEAST_ONE_SEP({ SEP: Comma, DEF: () => this.SUBRULE(this.expression) });
    this.CONSUME(RBrace);
  });
}

const parser = new MatrixParser();
type Context = Record<string, (IToken | CstNode)[]>;
const token = (ctx: Context, name: string, at = 0) => ctx[name]?.[at] as IToken;
const line = (ctx: Context, name: string) => token(ctx, name)?.startLine ?? 1;
function checkType(annotation: IToken | undefined): void {
  if (annotation && annotation.image !== 'nat') {
    throw new Error(`Line ${annotation.startLine ?? 1}: unsupported type '${annotation.image}'; only nat is implemented`);
  }
}
const BaseVisitor = parser.getBaseCstVisitorConstructor();
class AstVisitor extends BaseVisitor {
  constructor() { super(); this.validateVisitor(); }
  child(ctx: Context, name: string, at = 0): any { return this.visit(ctx[name]?.[at] as CstNode); }
  program(ctx: Context): Program { return { functions: ctx.functionDecl.map(node => this.visit(node as CstNode)) }; }
  functionDecl(ctx: Context): FunctionDecl {
    checkType(token(ctx, 'Identifier', 1));
    return { name: token(ctx, 'Identifier').image, params: (ctx.parameter ?? []).map(node => this.visit(node as CstNode)),
      body: this.child(ctx, 'block'), recursive: !!ctx.Rec, line: line(ctx, 'Fn') };
  }
  parameter(ctx: Context): string { checkType(token(ctx, 'Identifier', 1)); return token(ctx, 'Identifier').image; }
  block(ctx: Context): Stmt[] { return (ctx.statement ?? []).map(node => this.visit(node as CstNode)); }
  statement(ctx: Context): Stmt { return this.visit(Object.values(ctx)[0]![0] as CstNode); }
  letStatement(ctx: Context): Stmt {
    const at = line(ctx, 'Let');
    checkType(token(ctx, 'typeName'));
    if (ctx.tupleName) return { kind: 'parallelLet', names: ctx.tupleName.map(t => (t as IToken).image),
      branches: this.child(ctx, 'parallelExpression').branches, line: at };
    const size = ctx.NumberLiteral ? Number(token(ctx, 'NumberLiteral').image) : undefined;
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 1 || size > 256)) throw new Error(`Line ${at}: array capacity must be between 1 and 256`);
    return { kind: 'let', name: token(ctx, 'variableName').image, size,
      value: ctx.expression ? this.child(ctx, 'expression') : undefined, line: at };
  }
  ifStatement(ctx: Context): Stmt { return { kind: 'if', condition: this.child(ctx, 'expression'), then: this.child(ctx, 'block'), otherwise: ctx.block.length > 1 ? this.child(ctx, 'block', 1) : [], line: line(ctx, 'If') }; }
  whileStatement(ctx: Context): Stmt { return { kind: 'while', condition: this.child(ctx, 'expression'), body: this.child(ctx, 'block'), line: line(ctx, 'While') }; }
  returnStatement(ctx: Context): Stmt { return { kind: 'return', value: this.child(ctx, 'expression'), line: line(ctx, 'Return') }; }
  expressionStatement(ctx: Context): Stmt {
    const expression: Expr = this.child(ctx, 'expression');
    return ctx.Equals ? { kind: 'assign', target: expression, value: this.child(ctx, 'expression', 1), line: expression.line }
      : { kind: 'expr', expression, line: expression.line };
  }
  binary(ctx: Context, childName: string, operatorName: string): Expr {
    let left: Expr = this.child(ctx, childName);
    for (let i = 0; i < (ctx[operatorName]?.length ?? 0); i++) {
      left = { kind: 'binary', op: token(ctx, operatorName, i).image, left, right: this.child(ctx, childName, i + 1), line: left.line };
    }
    return left;
  }
  expression(ctx: Context): Expr { return this.binary(ctx, 'additive', 'Comparison'); }
  additive(ctx: Context): Expr { return this.binary(ctx, 'primary', 'AddOperator'); }
  primary(ctx: Context): Expr {
    if (ctx.NumberLiteral) {
      const value = Number(token(ctx, 'NumberLiteral').image);
      if (!Number.isInteger(value) || value > 4294967295) throw new Error(`Line ${line(ctx, 'NumberLiteral')}: number must fit unsigned 32 bits`);
      return { kind: 'number', value, line: line(ctx, 'NumberLiteral') };
    }
    if (ctx.StringLiteral) return { kind: 'string', value: JSON.parse(token(ctx, 'StringLiteral').image), line: line(ctx, 'StringLiteral') };
    if (ctx.parallelExpression) return this.child(ctx, 'parallelExpression');
    if (ctx.nested) return this.child(ctx, 'nested');
    const name = token(ctx, 'Identifier').image, at = line(ctx, 'Identifier');
    if (ctx.LParen) return { kind: 'call', name, args: (ctx.argument ?? []).map(node => this.visit(node as CstNode)), line: at };
    if (ctx.index) return { kind: 'index', name, index: this.child(ctx, 'index'), line: at };
    return { kind: 'variable', name, line: at };
  }
  parallelExpression(ctx: Context): Expr { return { kind: 'parallel', branches: ctx.expression.map(node => this.visit(node as CstNode)), line: line(ctx, 'Parallel') }; }
}
const visitor = new AstVisitor();

/** Parse source into a located AST. No repaired/partial syntax is executable. */
export function parse(source: string): Program {
  const lexed = lexer.tokenize(source);
  if (lexed.errors.length) {
    const error = lexed.errors[0]!;
    throw new Error(`Line ${error.line ?? 1}, column ${error.column ?? 1}: ${error.message}`);
  }
  parser.input = lexed.tokens;
  const cst = parser.program();
  if (parser.errors.length) {
    const error = parser.errors[0]!;
    const lines = source.split('\n');
    const atLine = Number.isFinite(error.token.startLine) && error.token.startLine! > 0 ? error.token.startLine : lines.length;
    const atColumn = Number.isFinite(error.token.startColumn) && error.token.startColumn! > 0 ? error.token.startColumn : lines.at(-1)!.length + 1;
    throw new Error(`Line ${atLine}, column ${atColumn}: ${error.message}`);
  }
  return visitor.visit(cst) as Program;
}
