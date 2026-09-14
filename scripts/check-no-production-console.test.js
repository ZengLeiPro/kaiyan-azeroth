const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { findProductionConsoleCalls } = require('./check-no-production-console');

function withFixture(files, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-production-console-'));
  try {
    const sourceRoot = path.join(root, 'apps/web/src');
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(sourceRoot, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    run(sourceRoot, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('阻断 Web 生产源码裸 console，忽略测试文件', () => {
  withFixture(
    {
      'feature.ts': "console.error('business error');",
      'feature.test.ts': "console.error('test spy target');",
    },
    (sourceRoot, root) => {
      assert.deepEqual(findProductionConsoleCalls(sourceRoot, root), [
        {
          file: 'apps/web/src/feature.ts',
          line: 1,
          source: "console.error('business error');",
        },
      ]);
    }
  );
});

test('仅允许带相邻明确理由的基础设施 console 出口', () => {
  withFixture(
    {
      'logger.ts':
        '// @console-ok: production logger sink; safe structured event only.\nconsole.error(event);',
      'bad.ts': '// @console-ok:\nconsole.warn(value);',
    },
    (sourceRoot, root) => {
      const violations = findProductionConsoleCalls(sourceRoot, root);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].file, 'apps/web/src/bad.ts');
    }
  );
});

test('AST 覆盖 computed、optional call、显式全局对象与 console 方法别名', () => {
  withFixture(
    {
      'variants.ts': [
        "console['error']('computed');",
        "console?.warn?.('optional');",
        'const consoleAlias = console;',
        "consoleAlias.info('object alias');",
        'const errorAlias = console.error;',
        "errorAlias('method alias');",
        'const { debug: debugAlias } = console;',
        "debugAlias('destructured alias');",
        "globalThis.console.error('globalThis console');",
        "window['console'].warn('window console');",
        'const windowConsoleAlias = window.console;',
        "windowConsoleAlias.info('window console alias');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      const violations = findProductionConsoleCalls(sourceRoot, root);
      assert.deepEqual(
        violations.map(({ line }) => line),
        [1, 2, 4, 6, 8, 9, 10, 12]
      );
    }
  );
});

test('AST 覆盖任意 thisArg 或无参数 bind 后直接调用及 bound 方法别名调用', () => {
  withFixture(
    {
      'bound.ts': [
        "console.error.bind(undefined)('direct bound call');",
        'const boundError = console.error.bind(undefined);',
        "boundError('bound alias call');",
        'const globalBoundWarn = globalThis.console.warn.bind(null);',
        "globalBoundWarn('global bound alias');",
        'const windowBoundInfo = window.console.info.bind(window);',
        "windowBoundInfo('window bound alias');",
        'const noThisArgDebug = console.debug.bind();',
        "noThisArgDebug('no thisArg alias');",
        'const reboundError = boundError;',
        "reboundError.call(undefined, 'bound alias chain');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [1, 3, 5, 7, 9, 11]
      );
    }
  );
});

test('bind 仅追踪真实 console 基表达式，不误报普通对象同名方法', () => {
  withFixture(
    {
      'ordinary-object.ts': [
        'const obj = { error: (..._args: unknown[]) => undefined };',
        'const ordinaryError = obj.error.bind(undefined);',
        "ordinaryError('not console');",
        "obj.error.bind(null)('still not console');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(findProductionConsoleCalls(sourceRoot, root), []);
    }
  );
});

test('豁免只绑定一个相邻调用，不能覆盖后续调用', () => {
  withFixture(
    {
      'targeted.ts': [
        '// @console-ok: one audited infrastructure sink only.',
        "console.error('allowed');",
        "console.warn('must fail');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(findProductionConsoleCalls(sourceRoot, root), [
        {
          file: 'apps/web/src/targeted.ts',
          line: 3,
          source: "console.warn('must fail');",
        },
      ]);
    }
  );
});

test('@console-ok 仅接受紧邻调用的真实注释 trivia，字符串与非相邻注释不能冒充', () => {
  withFixture(
    {
      'fake-exemptions.ts': [
        '"// @console-ok: string literal is not an exemption";',
        "console.error('string must fail');",
        'const marker = `/* @console-ok: template literal is not an exemption */`;',
        "console.warn('template must fail');",
        '// @console-ok: blank line makes this non-adjacent.',
        '',
        "console.info('non-adjacent must fail');",
        "/* @console-ok: adjacent block comment remains a real exemption. */ console.debug('allowed');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [2, 4, 7]
      );
    }
  );
});

test('局部参数与变量名 console 及局部全局对象名不误报', () => {
  withFixture(
    {
      'shadowed.ts': [
        'function withParameter(console: { error(message: string): void }) {',
        "  console.error('local parameter');",
        '}',
        'function withVariable() {',
        '  const console = { warn: (_message: string) => undefined };',
        "  console.warn('local variable');",
        '}',
        'function withOwners(globalThis: any, window: any) {',
        "  globalThis.console.error('local globalThis');",
        "  window.console.warn('local window');",
        '}',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(findProductionConsoleCalls(sourceRoot, root), []);
    }
  );
});

test('同名方法 alias 按 symbol 与函数作用域隔离', () => {
  withFixture(
    {
      'scoped.ts': [
        'const obj = { error: (..._args: unknown[]) => undefined };',
        'function realSink() {',
        '  const sink = console.error;',
        "  sink('must fail');",
        '}',
        'function ordinarySink() {',
        '  const sink = obj.error;',
        "  sink('not console');",
        '}',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [4]
      );
    }
  );
});

test('console 对象与方法 alias 重赋普通值后立即失效', () => {
  withFixture(
    {
      'reassigned.ts': [
        'const obj = { error: (..._args: unknown[]) => undefined };',
        'let consoleAlias = console;',
        "consoleAlias.error('must fail before reassignment');",
        'consoleAlias = obj;',
        "consoleAlias.error('not console after reassignment');",
        'let sink = console.error;',
        "sink('must fail before reassignment');",
        'sink = obj.error.bind(undefined);',
        "sink('not console after reassignment');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [3, 7]
      );
    }
  );
});

test('真实对象、destructure、bind、call/apply alias 跨闭包仍阻断', () => {
  withFixture(
    {
      'closure.ts': [
        'const outerConsole = globalThis.console;',
        'const boundError = outerConsole.error.bind(undefined);',
        "const invoke = () => outerConsole.warn.call(undefined, 'object alias in closure');",
        "const invokeBound = () => boundError.apply(undefined, ['method alias in closure']);",
        'const { console: windowConsole } = window;',
        "const invokeDestructured = () => windowConsole.info('destructured object in closure');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [3, 4, 6]
      );
    }
  );
});

test('分支、conditional、switch 与零次循环按 may-alias 合流，直线重赋仍可失效', () => {
  withFixture(
    {
      'control-flow.ts': [
        'declare const flag: boolean;',
        'declare const kind: string;',
        'const noop = (..._args: unknown[]) => undefined;',
        'let branch = console.error;',
        'if (flag) branch = noop;',
        "branch('if may retain console');",
        'let conditional = noop;',
        'conditional = flag ? console.warn : noop;',
        "conditional('conditional may choose console');",
        'let switched = console.info;',
        "switch (kind) { case 'off': switched = noop; break; }",
        "switched('switch may miss case');",
        'let looped = console.debug;',
        'while (flag) looped = noop;',
        "looped('loop may execute zero times');",
        'let introduced = noop;',
        'for (; flag; ) introduced = console.log;',
        "introduced('loop may introduce console');",
        'let straight = console.error;',
        'straight = noop;',
        "straight('definitely no longer console');",
        'let allBranches = console.warn;',
        'if (flag) allBranches = noop; else allBranches = noop;',
        "allBranches('all paths definitely clear alias');",
        'let doOnce = console.info;',
        'do doOnce = noop; while (flag);',
        "doOnce('do executes at least once');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [6, 9, 12, 15, 18]
      );
    }
  );
});

test('闭包自由变量在直接调用点取状态：调用前赋 console 命中、调用前赋 noop 不误报', () => {
  withFixture(
    {
      'invocation-state.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'let lateConsole = noop;',
        "function reportLate() { lateConsole('assigned before call'); }",
        'lateConsole = console.error;',
        'reportLate();',
        'let cleared = console.warn;',
        "const reportCleared = () => cleared('cleared before call');",
        'cleared = noop;',
        'reportCleared();',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [3]
      );
    }
  );
});

test('赋值式解构与默认参数保留 console 方法 alias', () => {
  withFixture(
    {
      'destructure-and-defaults.ts': [
        'let assigned = (..._args: unknown[]) => undefined;',
        '({ error: assigned } = console);',
        "assigned('assignment destructuring');",
        'let owner: Console;',
        '({ console: owner } = globalThis);',
        "owner.warn('assignment owner destructuring');",
        "function defaultMethod(sink = console.info) { sink('default method'); }",
        "function defaultObject({ debug: sink } = console) { sink('default object'); }",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [3, 6, 7, 8]
      );
    }
  );
});

test('块级同名绑定按 TypeScript symbol 隔离，不污染外层 may-alias', () => {
  withFixture(
    {
      'block-scope.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'let outerSafe = noop;',
        '{',
        '  let outerSafe = console.error;',
        '  outerSafe = noop;',
        '}',
        "outerSafe('outer remains safe');",
        'let outerConsole = console.warn;',
        '{',
        '  let outerConsole = noop;',
        "  outerConsole('inner remains safe');",
        '}',
        "outerConsole('outer remains console');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [13]
      );
    }
  );
});

test('逃逸回调在逃逸点取 live env，反向重赋与回调变量别名不误判', () => {
  withFixture(
    {
      'escaped-callback.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'let sink = noop;',
        "const callback = () => sink('escaped callback');",
        'const callbackAlias = callback;',
        'sink = console.error;',
        'setTimeout(callbackAlias, 0);',
        'let cleared = console.warn;',
        "const safeCallback = () => cleared('cleared before escape');",
        'const safeAlias = safeCallback;',
        'cleared = noop;',
        'queueMicrotask(safeAlias);',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [3]
      );
    }
  );
});

test('显式 undefined 触发默认参数，普通实参压制默认 console', () => {
  withFixture(
    {
      'explicit-undefined.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        "function invokeDefault(sink = console.info) { sink('default'); }",
        'invokeDefault(undefined);',
        "function invokeSafe(sink = console.debug) { sink('explicit safe'); }",
        'invokeSafe(noop);',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [2]
      );
    }
  );
});

test('apply 展开数组参数，bind 保留本地函数 target 与绑定参数', () => {
  withFixture(
    {
      'apply-and-bind.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        "function invoke(sink: (...args: unknown[]) => void) { sink('invoke'); }",
        'invoke.apply(null, [console.error]);',
        'invoke.apply(null, [noop]);',
        'invoke.bind(null, console.warn)();',
        'invoke.bind(null, noop)();',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [2]
      );
    }
  );
});

test('do 块 abrupt completion 截断不可达语句，并保留 break 前状态', () => {
  withFixture(
    {
      'do-abrupt.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'let cleared = console.debug;',
        'do { cleared = noop; break; cleared = console.debug; } while (false);',
        "cleared('safe after break');",
        'let retained = noop;',
        'do { retained = console.log; break; retained = noop; } while (false);',
        "retained('console retained at break');",
        'function unreachable() {',
        '  let afterReturn = noop;',
        '  return;',
        '  afterReturn = console.error;',
        "  afterReturn('unreachable');",
        '}',
        'function returnedBranch(flag: boolean) {',
        '  let branchSink = noop;',
        '  if (flag) { branchSink = console.warn; return; }',
        "  branchSink('return branch must not reach here');",
        '}',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [7]
      );
    }
  );
});

test('同一闭包多次调用分别读取调用点状态，任一 console 路径只报告一次定义内调用', () => {
  withFixture(
    {
      'multiple-calls.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'let sink = noop;',
        "const callback = () => sink('multiple calls');",
        'callback();',
        'sink = console.warn;',
        'callback();',
        'sink = noop;',
        'callback();',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [3]
      );
    }
  );
});

test('对象字面量保留属性函数，覆盖别名、方法解构、逃逸与调用点自由变量状态', () => {
  withFixture(
    {
      'object-methods.ts': [
        'declare function consume(value: unknown): void;',
        'const noop = (..._args: unknown[]) => undefined;',
        'let late = noop;',
        "const holder = { run() { late('late object method'); } };",
        'late = console.error;',
        'const holderAlias = holder;',
        'holderAlias.run();',
        "const destructuredOwner = { run: () => console.warn('destructured method') };",
        'const { run } = destructuredOwner;',
        'run();',
        "consume({ run: () => console.info('escaped object method') });",
        "({ run: () => console.debug('latent object method') });",
        'let cleared = console.error;',
        "const safeHolder = { run() { cleared('cleared object method'); } };",
        'cleared = noop;',
        'safeHolder.run();',
        "const direct = { run() { console.error('direct object method'); } };",
        'direct.run();',
        "const ordinary = { run() { noop('ordinary object method'); } };",
        'const ordinaryAlias = ordinary;',
        'const { run: safeRun } = ordinaryAlias;',
        'safeRun();',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [4, 8, 11, 12, 17]
      );
    }
  );
});

test('普通调用 spread 展开数组字面量、spread 数组与数组变量', () => {
  withFixture(
    {
      'spread-arguments.ts': [
        "function invoke(sink: (...args: unknown[]) => void) { sink('spread'); }",
        'const noop = (..._args: unknown[]) => undefined;',
        'invoke(...[console.error]);',
        'const warningArgs = [...[console.warn]];',
        'invoke(...warningArgs);',
        'const safeArgs = [noop];',
        'invoke(...safeArgs);',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [1]
      );
    }
  );
});

test('递归与多层互递归调用以参数状态 fixed-point 传播 console', () => {
  withFixture(
    {
      'recursive-arguments.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        "function recursive(i: number, sink: (...args: unknown[]) => void) { if (!i) { sink('recursive'); return; } recursive(i - 1, console.error); }",
        'recursive(1, noop);',
        "function outer(i: number, sink: (...args: unknown[]) => void) { if (!i) { sink('mutual'); return; } inner(i - 1, sink); }",
        'function inner(i: number, sink: (...args: unknown[]) => void) { outer(i, console.warn); }',
        'outer(1, noop);',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [2, 4]
      );
    }
  );
});

test('无 condition 与字面量 true 循环至少执行一次，字面量 false 不执行', () => {
  withFixture(
    {
      'literal-loops.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'let forever = console.error;',
        'for (;;) { forever = noop; break; }',
        "forever('cleared by mandatory for');",
        'let trueLoop = console.warn;',
        'for (; true; ) { trueLoop = noop; break; }',
        "trueLoop('cleared by literal true for');",
        'let falseLoop = console.info;',
        'for (; false; ) falseLoop = noop;',
        "falseLoop('literal false for retains console');",
        'let falseWhile = console.debug;',
        'while (false) falseWhile = noop;',
        "falseWhile('literal false while retains console');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [10, 13]
      );
    }
  );
});

test('成员与数组属性支持强更新读取，动态成员对真实 console 值 fail-closed', () => {
  withFixture(
    {
      'member-array.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'const holder = { run: noop };',
        'holder.run = console.error;',
        "holder.run('member assignment');",
        'holder.run = noop;',
        "holder.run('safe member overwrite');",
        "[console.info][0]?.('array literal');",
        'const entries = [console.warn];',
        'entries[0] = noop;',
        "entries[0]('safe array overwrite');",
        "const dynamicKey = 'run';",
        'const dynamicHolder = { run: noop };',
        'dynamicHolder[dynamicKey] = console.debug;',
        "dynamicHolder[dynamicKey]('dynamic member');",
        "function shadow(console: { error: (...args: unknown[]) => void }) { const local = { run: console.error }; local.run('shadow safe'); }",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [4, 7, 14]
      );
    }
  );
});

test('对象 spread 与数组显式安全覆盖执行强更新，不保留被覆盖 console', () => {
  withFixture(
    {
      'safe-overrides.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'const bad = { run: console.error };',
        'const safe = { ...bad, run: noop };',
        "safe.run('safe explicit override');",
        'const stillBad = { run: noop, ...bad };',
        "stillBad.run('spread overwrites noop');",
        'const values = [console.warn];',
        'values[0] = noop;',
        "values[0]('safe array update');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [6]
      );
    }
  );
});

test('class 实例方法参数、getter、闭包与动态字段沿调用点分派', () => {
  withFixture(
    {
      'class-dispatch.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        "class Handler { run(sink: (...args: unknown[]) => void) { sink('method parameter'); } get current() { return console.warn; } }",
        'const handler = new Handler();',
        'handler.run(console.error);',
        "handler.current('getter result');",
        'let late = noop;',
        "class Closure { run() { late('class closure'); } }",
        'const closure = new Closure();',
        'late = console.info;',
        'closure.run();',
        "const key = 'sink';",
        'class DynamicField { [key] = console.debug; }',
        'const dynamic = new DynamicField();',
        "dynamic[key]('dynamic class field');",
        'class Safe { run(sink: (...args: unknown[]) => void) { sink(); } }',
        'new Safe().run(noop);',
        'let cleared = console.error;',
        "class Cleared { run() { cleared('safe closure'); } get current() { return cleared; } }",
        'cleared = noop;',
        'const clearedInstance = new Cleared();',
        'clearedInstance.run();',
        "clearedInstance.current('safe getter');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [2, 5, 7, 14]
      );
    }
  );
});

test('throw 状态进入 catch，continue 状态进入循环回边', () => {
  withFixture(
    {
      'catch-continue.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'let caught = noop;',
        'try { caught = console.error; throw new Error(); caught = noop; }',
        "catch { caught('throw state'); }",
        'let looped = noop;',
        'let keepGoing = true;',
        'while (keepGoing) {',
        '  looped = console.warn;',
        '  keepGoing = false;',
        '  continue;',
        '  looped = noop;',
        '}',
        "looped('continue back edge');",
        'let safe = console.info;',
        'while (true) { safe = noop; break; }',
        "safe('safe mandatory loop overwrite');",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [4, 13]
      );
    }
  );
});

test('bodyless ambient 调用分析对象与数组回调，并在原始 console 容器逃逸点 fail-closed', () => {
  withFixture(
    {
      'ambient-escape.ts': [
        'declare function consume(value: unknown): void;',
        "consume({ run: () => console.error('object callback') });",
        "consume([() => console.warn('array callback')]);",
        'consume({ run: console.info });',
        'const noop = (..._args: unknown[]) => undefined;',
        'consume({ run: noop });',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [2, 3, 4]
      );
    }
  );
});

test('JSX handler、handler alias 与 props spread 均按逃逸点分析', () => {
  withFixture(
    {
      'jsx-handlers.tsx': [
        'const noop = () => undefined;',
        "const inline = <button onClick={() => console.error('inline')} />;",
        "const click = () => console.warn('alias');",
        'const aliased = <button onClick={click} />;',
        "const props = { onClick: () => console.log('spread') };",
        'const spread = <button {...props} />;',
        'const safe = <button onClick={noop} />;',
        'const direct = <button onClick={console.error} />;',
        'const directAlias = console.warn;',
        'const aliasHandler = <button onClick={directAlias} />;',
        'const bound = <button onClick={console.info.bind(console)} />;',
        'const directProps = { onClick: console.debug };',
        'const spreadDirect = <button {...directProps} />;',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [2, 3, 5, 8, 10, 11, 13]
      );
    }
  );
});

test('显式 throw 仅把真实 throw 状态送入 catch，不合入已过时入口状态', () => {
  withFixture(
    {
      'catch-state.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        'let safe = console.error;',
        'try { safe = noop; throw new Error(); } catch { safe(); }',
        'let bad = noop;',
        'try { bad = console.warn; throw new Error(); } catch { bad(); }',
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [5]
      );
    }
  );
});

test('无限循环与 try/finally completion 截断不可达调用，finally abrupt 覆盖', () => {
  withFixture(
    {
      'unreachable-completion.ts': [
        'const noop = (..._args: unknown[]) => undefined;',
        "function loopReturn() { while (true) { return; } console.error('unreachable after loop'); }",
        "function tryReturn() { try { return; } finally { noop(); } console.warn('unreachable after finally'); }",
        "function catchReturn() { try { throw new Error(); } catch { return; } console.info('unreachable after catch'); }",
        "function finallyCall() { try { return; } finally { console.debug('reachable finally'); } }",
      ].join('\n'),
    },
    (sourceRoot, root) => {
      assert.deepEqual(
        findProductionConsoleCalls(sourceRoot, root).map(({ line }) => line),
        [5]
      );
    }
  );
});
