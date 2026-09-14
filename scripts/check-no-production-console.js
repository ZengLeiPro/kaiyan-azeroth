#!/usr/bin/env node
/** Block raw console calls from Web production source. Narrow exceptions require an adjacent reason. */

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const WEB_SOURCE = path.join(ROOT, 'apps/web/src');
const SOURCE_PATTERN = /\.(?:ts|tsx)$/;
const TEST_PATTERN = /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.(?:ts|tsx)$)/;
const ALLOW_REASON_PATTERN = /@console-ok:\s*\S.+/;
const CONSOLE_METHODS = new Set(['log', 'error', 'warn', 'info', 'debug']);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && SOURCE_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(expression) {
  const current = unwrap(expression);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) {
    const argument = current.argumentExpression && unwrap(current.argumentExpression);
    if (
      argument &&
      (ts.isStringLiteral(argument) ||
        ts.isNumericLiteral(argument) ||
        ts.isNoSubstitutionTemplateLiteral(argument))
    ) {
      return argument.text;
    }
  }
  return undefined;
}

function findConsoleCallNodes(sourceFile, checker) {
  const CONSOLE_OBJECT = 'console-object';
  const EXPLICIT_UNDEFINED = Symbol('explicit-undefined');
  const calls = new Map();
  const functionBindings = new Map();
  const moduleFunctions = new Set();
  const analyzedFunctions = new Set();
  const functionAnalysisStates = new Map();
  const objectValues = new WeakMap();
  const classValues = new WeakMap();
  const THIS_BINDING = Symbol('this-binding');
  const UNKNOWN_PROPERTY = Symbol('unknown-property');

  const isBoundFunction = (value) => value?.kind === 'bound-function';
  const isArrayValue = (value) => value?.kind === 'array-value';
  const isObjectValue = (value) => value?.kind === 'object-value';
  const isClassValue = (value) => value?.kind === 'class-value';

  const symbolFor = (identifier) => checker.getSymbolAtLocation(identifier);
  const cloneEnv = (env) => new Map([...env].map(([symbol, values]) => [symbol, new Set(values)]));
  const unionValues = (...valueSets) => new Set(valueSets.flatMap((values) => [...values]));
  const envValue = (env, symbol) => (symbol ? (env.get(symbol) ?? new Set()) : new Set());
  const setEnvValue = (env, symbol, values) => {
    if (!symbol) return;
    if (values.size === 0) env.delete(symbol);
    else env.set(symbol, new Set(values));
  };
  const mergeEnvs = (...envs) => {
    const merged = new Map();
    for (const env of envs.filter(Boolean)) {
      for (const [symbol, values] of env) {
        setEnvValue(merged, symbol, unionValues(envValue(merged, symbol), values));
      }
    }
    return merged;
  };
  const envEquals = (left, right) => {
    const symbols = new Set([...left.keys(), ...right.keys()]);
    return [...symbols].every((symbol) => {
      const leftValues = envValue(left, symbol);
      const rightValues = envValue(right, symbol);
      return (
        leftValues.size === rightValues.size &&
        [...leftValues].every((value) => rightValues.has(value))
      );
    });
  };

  const isUnshadowedGlobal = (expression, names) => {
    const current = unwrap(expression);
    if (!ts.isIdentifier(current) || !names.has(current.text)) return false;
    const symbol = symbolFor(current);
    return !symbol?.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile);
  };

  const nameFor = (name) => {
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name)
    ) {
      return name.text;
    }
    if (ts.isComputedPropertyName(name)) {
      const expression = unwrap(name.expression);
      if (
        ts.isStringLiteral(expression) ||
        ts.isNumericLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression)
      ) {
        return expression.text;
      }
    }
    return undefined;
  };

  const propertyValues = (owners, property) => {
    const values = new Set();
    if (property && CONSOLE_METHODS.has(property) && owners.has(CONSOLE_OBJECT)) {
      values.add(property);
    }
    for (const owner of owners) {
      if (isArrayValue(owner)) {
        if (property !== undefined && /^\d+$/.test(property)) {
          for (const value of owner.elements[Number(property)] ?? []) values.add(value);
        } else if (property === undefined) {
          for (const elements of owner.elements) for (const value of elements) values.add(value);
        }
        for (const value of owner.unknown ?? []) values.add(value);
      } else if (isObjectValue(owner) || isClassValue(owner)) {
        if (property !== undefined) {
          for (const value of owner.properties.get(property) ?? []) values.add(value);
        } else {
          for (const propertySet of owner.properties.values()) {
            for (const value of propertySet) values.add(value);
          }
        }
        for (const value of owner.properties.get(UNKNOWN_PROPERTY) ?? []) values.add(value);
      }
    }
    return values;
  };

  const valueFor = (expression, env) => {
    if (!expression) return new Set();
    const current = unwrap(expression);
    if (ts.isIdentifier(current)) {
      if (isUnshadowedGlobal(current, new Set(['console']))) return new Set([CONSOLE_OBJECT]);
      if (isUnshadowedGlobal(current, new Set(['undefined']))) {
        return new Set([EXPLICIT_UNDEFINED]);
      }
      return new Set(envValue(env, symbolFor(current)));
    }
    if (ts.isThis(current)) return new Set(envValue(env, THIS_BINDING));
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      const property = propertyName(current);
      if (
        property === 'console' &&
        isUnshadowedGlobal(current.expression, new Set(['globalThis', 'window']))
      ) {
        return new Set([CONSOLE_OBJECT]);
      }
      return propertyValues(valueFor(current.expression, env), property);
    }
    if (ts.isVoidExpression(current)) return new Set([EXPLICIT_UNDEFINED]);
    if (ts.isCallExpression(current)) return new Set();
    if (ts.isConditionalExpression(current)) {
      return unionValues(valueFor(current.whenTrue, env), valueFor(current.whenFalse, env));
    }
    if (
      ts.isBinaryExpression(current) &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(current.operatorToken.kind)
    ) {
      return unionValues(valueFor(current.left, env), valueFor(current.right, env));
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return valueFor(current.right, env);
    }
    return new Set();
  };

  const methodValues = (values) =>
    new Set([...values].filter((value) => CONSOLE_METHODS.has(value)));

  const bindingPropertyName = (element) => {
    const sourceName = element.propertyName ?? element.name;
    return ts.isIdentifier(sourceName) || ts.isStringLiteral(sourceName)
      ? sourceName.text
      : undefined;
  };

  const clearPattern = (pattern, env) => {
    const current = unwrap(pattern);
    if (ts.isIdentifier(current)) {
      setEnvValue(env, symbolFor(current), new Set());
      return;
    }
    if (ts.isObjectBindingPattern(current) || ts.isArrayBindingPattern(current)) {
      for (const element of current.elements) {
        if (ts.isBindingElement(element)) clearPattern(element.name, env);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current)) {
      for (const element of current.elements ?? current.properties) {
        if (ts.isPropertyAssignment(element)) clearPattern(element.initializer, env);
        else if (ts.isShorthandPropertyAssignment(element)) clearPattern(element.name, env);
        else if (ts.isSpreadAssignment(element) || ts.isSpreadElement(element)) {
          clearPattern(element.expression, env);
        } else if (ts.isOmittedExpression(element)) {
          continue;
        } else {
          clearPattern(element, env);
        }
      }
    }
  };

  const propertyAlias = (sourceExpression, sourceValues, property) => {
    const aliases = propertyValues(sourceValues, property);
    if (
      property === 'console' &&
      sourceExpression &&
      isUnshadowedGlobal(sourceExpression, new Set(['globalThis', 'window']))
    ) {
      aliases.add(CONSOLE_OBJECT);
    }
    return aliases;
  };

  const assignPattern = (pattern, sourceExpression, sourceValues, env) => {
    const current = unwrap(pattern);
    if (ts.isIdentifier(current)) {
      setEnvValue(env, symbolFor(current), sourceValues);
      return;
    }
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      const property = propertyName(current);
      const owners = valueFor(current.expression, env);
      for (const owner of owners) {
        if (isArrayValue(owner)) {
          if (property !== undefined && /^\d+$/.test(property)) {
            owner.elements[Number(property)] = new Set(sourceValues);
          } else {
            owner.unknown = unionValues(owner.unknown ?? new Set(), sourceValues);
          }
        } else if (isObjectValue(owner) || isClassValue(owner)) {
          if (property !== undefined) owner.properties.set(property, new Set(sourceValues));
          else {
            owner.properties.set(
              UNKNOWN_PROPERTY,
              unionValues(owner.properties.get(UNKNOWN_PROPERTY) ?? new Set(), sourceValues)
            );
          }
        }
      }
      return;
    }
    if (ts.isObjectBindingPattern(current)) {
      for (const element of current.elements) {
        const property = bindingPropertyName(element);
        const aliases = property
          ? propertyAlias(sourceExpression, sourceValues, property)
          : new Set();
        assignPattern(element.name, undefined, aliases, env);
      }
      return;
    }
    if (ts.isArrayBindingPattern(current)) {
      const arrays = [...sourceValues].filter(isArrayValue);
      for (let index = 0; index < current.elements.length; index += 1) {
        const element = current.elements[index];
        if (!ts.isBindingElement(element)) continue;
        const values = unionValues(
          ...arrays.map((array) => array.elements[index] ?? new Set([EXPLICIT_UNDEFINED]))
        );
        assignPattern(element.name, undefined, values, env);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(current)) {
      for (const propertyNode of current.properties) {
        if (ts.isPropertyAssignment(propertyNode)) {
          const property =
            ts.isIdentifier(propertyNode.name) || ts.isStringLiteral(propertyNode.name)
              ? propertyNode.name.text
              : undefined;
          assignPattern(
            propertyNode.initializer,
            undefined,
            property ? propertyAlias(sourceExpression, sourceValues, property) : new Set(),
            env
          );
        } else if (ts.isShorthandPropertyAssignment(propertyNode)) {
          assignPattern(
            propertyNode.name,
            undefined,
            propertyAlias(sourceExpression, sourceValues, propertyNode.name.text),
            env
          );
        } else if (ts.isSpreadAssignment(propertyNode)) {
          clearPattern(propertyNode.expression, env);
        }
      }
      return;
    }
    clearPattern(current, env);
  };

  const classValueFor = (node) => {
    let classValue = classValues.get(node);
    if (classValue) return classValue;
    classValue = {
      kind: 'class-value',
      properties: new Map(),
      instanceProperties: new Map(),
      fields: [],
      constructor: undefined,
    };
    classValues.set(node, classValue);
    for (const member of node.members) {
      const isStatic = member.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword
      );
      if (ts.isConstructorDeclaration(member)) {
        classValue.constructor = member;
      } else if (
        ts.isMethodDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)
      ) {
        const property = nameFor(member.name) ?? UNKNOWN_PROPERTY;
        (isStatic ? classValue.properties : classValue.instanceProperties).set(
          property,
          new Set([member])
        );
      } else if (ts.isPropertyDeclaration(member)) {
        classValue.fields.push({ member, isStatic });
      }
    }
    return classValue;
  };

  const registerFunctions = (node, functionDepth = 0) => {
    if (ts.isFunctionDeclaration(node)) {
      if (node.name) {
        const symbol = symbolFor(node.name);
        if (symbol) functionBindings.set(symbol, node);
      }
      if (functionDepth === 0) moduleFunctions.add(node);
      ts.forEachChild(node, (child) => registerFunctions(child, functionDepth + 1));
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(unwrap(node.initializer)) ||
        ts.isFunctionExpression(unwrap(node.initializer)))
    ) {
      const fn = unwrap(node.initializer);
      const symbol = symbolFor(node.name);
      if (symbol) functionBindings.set(symbol, fn);
      if (functionDepth === 0) moduleFunctions.add(fn);
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (functionDepth === 0) moduleFunctions.add(node);
      ts.forEachChild(node, (child) => registerFunctions(child, functionDepth + 1));
      return;
    }
    if (
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      if (functionDepth === 0) moduleFunctions.add(node);
      ts.forEachChild(node, (child) => registerFunctions(child, functionDepth + 1));
      return;
    }
    ts.forEachChild(node, (child) => registerFunctions(child, functionDepth));
  };
  registerFunctions(sourceFile);

  const recordCall = (node) => calls.set(node.getStart(sourceFile), node);

  let evalExpression;
  let analyzeStatement;
  let analyzeFunction;

  const evaluateArguments = (args, env) => {
    const values = [];
    let current = env;
    for (const argument of args) {
      const result = evalExpression(
        ts.isSpreadElement(argument) ? argument.expression : argument,
        current
      );
      current = result.env;
      if (ts.isSpreadElement(argument)) {
        const spreadValues = applyArguments(result.value);
        if (spreadValues) values.push(...spreadValues);
        else values.push(result.value);
      } else {
        values.push(result.value);
      }
    }
    return { env: current, values };
  };

  analyzeFunction = (node, outerEnv, argumentValues, generic = false, thisValues = new Set()) => {
    analyzedFunctions.add(node);
    let state = functionAnalysisStates.get(node);
    if (!state) {
      state = {
        argumentValues: node.parameters.map(() => new Set()),
        omitted: node.parameters.map(() => false),
        outerEnv: new Map(),
        thisValues: new Set(),
        returnValues: new Set(),
        processing: false,
        dirty: false,
      };
      functionAnalysisStates.set(node, state);
    }

    const mergedOuterEnv = mergeEnvs(state.outerEnv, outerEnv);
    if (!envEquals(mergedOuterEnv, state.outerEnv)) {
      state.outerEnv = mergedOuterEnv;
      state.dirty = true;
    }
    const mergedThis = unionValues(state.thisValues, thisValues);
    if (mergedThis.size !== state.thisValues.size) {
      state.thisValues = mergedThis;
      state.dirty = true;
    }
    for (let index = 0; index < node.parameters.length; index += 1) {
      const wasProvided = argumentValues !== undefined && index < argumentValues.length;
      if (!wasProvided && !state.omitted[index]) {
        state.omitted[index] = true;
        state.dirty = true;
      }
      if (wasProvided) {
        const merged = unionValues(state.argumentValues[index], argumentValues[index]);
        if (merged.size !== state.argumentValues[index].size) {
          state.argumentValues[index] = merged;
          state.dirty = true;
        }
      }
    }

    if (state.processing) return outerEnv;
    state.processing = true;
    let resultEnv = outerEnv;
    for (let iteration = 0; state.dirty && iteration < 32; iteration += 1) {
      state.dirty = false;
      let env = cloneEnv(state.outerEnv);
      setEnvValue(env, THIS_BINDING, state.thisValues);
      for (let index = 0; index < node.parameters.length; index += 1) {
        const parameter = node.parameters[index];
        let values = new Set(state.argumentValues[index]);
        if (state.omitted[index] || values.has(EXPLICIT_UNDEFINED)) {
          values.delete(EXPLICIT_UNDEFINED);
          if (parameter.initializer) {
            const result = evalExpression(parameter.initializer, env);
            env = result.env;
            values = unionValues(values, result.value);
          }
        }
        assignPattern(parameter.name, undefined, values, env);
      }
      if (node.body) {
        if (ts.isBlock(node.body)) {
          const result = analyzeStatement(node.body, env);
          const completionEnvs = [
            result.normal,
            ...result.abrupts.map((entry) => entry.env),
          ].filter(Boolean);
          env = completionEnvs.length > 0 ? mergeEnvs(...completionEnvs) : env;
          state.returnValues = unionValues(
            state.returnValues,
            ...result.abrupts
              .filter((entry) => entry.type === 'return')
              .map((entry) => entry.value ?? new Set())
          );
        } else {
          const result = evalExpression(node.body, env);
          env = result.env;
          state.returnValues = unionValues(state.returnValues, result.value);
        }
      }
      resultEnv = env;
    }
    state.processing = false;
    return generic ? outerEnv : resultEnv;
  };

  const methodsIn = (values) => {
    const methods = new Set();
    const visit = (value) => {
      if (CONSOLE_METHODS.has(value)) methods.add(value);
      else if (isBoundFunction(value)) for (const target of value.target) visit(target);
    };
    for (const value of values) visit(value);
    return methods;
  };

  const invokeValues = (values, args, inputEnv, generic = false, thisValues = new Set()) => {
    let env = inputEnv;
    let invoked = false;
    let ambient = false;
    for (const value of values) {
      if (CONSOLE_METHODS.has(value)) {
        invoked = true;
      } else if (ts.isFunctionLike(value)) {
        invoked = true;
        if (value.body) env = analyzeFunction(value, env, args, generic, thisValues);
        else ambient = true;
      } else if (isBoundFunction(value)) {
        invoked = true;
        const result = invokeValues(
          value.target,
          [...value.args, ...args],
          env,
          generic,
          thisValues
        );
        env = result.env;
        ambient ||= result.ambient;
      }
    }
    return { env, invoked, ambient };
  };

  const analyzeEscapedValues = (values, env) => {
    const visit = (value) => {
      if (ts.isFunctionLike(value)) analyzeFunction(value, env, undefined, true);
      else if (isBoundFunction(value)) invokeValues(new Set([value]), [], env, true);
      else if (isArrayValue(value)) {
        for (const elementValues of value.elements)
          for (const element of elementValues) visit(element);
      } else if (isObjectValue(value) || isClassValue(value)) {
        for (const propertyValues of value.properties.values()) {
          for (const propertyValue of propertyValues) visit(propertyValue);
        }
        if (isClassValue(value)) {
          for (const propertyValues of value.instanceProperties.values()) {
            for (const propertyValue of propertyValues) visit(propertyValue);
          }
        }
      }
    };
    for (const value of values) visit(value);
  };

  const containsConsoleCapability = (values, seen = new Set()) => {
    for (const value of values) {
      if (value === CONSOLE_OBJECT || CONSOLE_METHODS.has(value)) return true;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (isBoundFunction(value) && containsConsoleCapability(value.target, seen)) return true;
      if (
        isArrayValue(value) &&
        (value.elements.some((elements) => containsConsoleCapability(elements, seen)) ||
          containsConsoleCapability(value.unknown ?? new Set(), seen))
      ) {
        return true;
      }
      if (isObjectValue(value) || isClassValue(value)) {
        if (
          [...value.properties.values()].some((propertySet) =>
            containsConsoleCapability(propertySet, seen)
          )
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const applyArguments = (values) => {
    const arrays = [...values].filter(isArrayValue);
    if (arrays.length === 0) return undefined;
    const length = Math.max(...arrays.map((array) => array.elements.length));
    return Array.from({ length }, (_, index) =>
      unionValues(...arrays.map((array) => array.elements[index] ?? new Set([EXPLICIT_UNDEFINED])))
    );
  };

  const readMember = (owners, property, inputEnv) => {
    let env = inputEnv;
    const values = new Set();
    for (const value of propertyValues(owners, property)) {
      if (ts.isGetAccessorDeclaration(value)) {
        env = analyzeFunction(value, env, [], false, owners);
        const state = functionAnalysisStates.get(value);
        if (state) for (const returnValue of state.returnValues) values.add(returnValue);
      } else if (!ts.isSetAccessorDeclaration(value)) {
        values.add(value);
      }
    }
    return { env, value: values, owner: owners };
  };

  const instantiateClass = (classValue, args, inputEnv) => {
    let env = inputEnv;
    const instance = {
      kind: 'object-value',
      properties: new Map(
        [...classValue.instanceProperties].map(([name, values]) => [name, new Set(values)])
      ),
    };
    const thisValues = new Set([instance]);
    for (const { member, isStatic } of classValue.fields) {
      if (isStatic || !member.initializer) continue;
      const fieldEnv = cloneEnv(env);
      setEnvValue(fieldEnv, THIS_BINDING, thisValues);
      const result = evalExpression(member.initializer, fieldEnv);
      env = result.env;
      const property = nameFor(member.name);
      if (property) instance.properties.set(property, new Set(result.value));
      else {
        instance.properties.set(
          UNKNOWN_PROPERTY,
          unionValues(instance.properties.get(UNKNOWN_PROPERTY) ?? new Set(), result.value)
        );
      }
    }
    if (classValue.constructor) {
      env = analyzeFunction(classValue.constructor, env, args, false, thisValues);
    }
    return { env, value: new Set([instance]) };
  };

  const evalJsxNode = (jsxNode, inputEnv) => {
    let env = inputEnv;
    const visit = (node) => {
      if (ts.isJsxExpression(node)) {
        if (node.expression) {
          const result = evalExpression(node.expression, env);
          env = result.env;
          analyzeEscapedValues(result.value, env);
          if (containsConsoleCapability(result.value)) recordCall(node.expression);
        }
        return;
      }
      if (ts.isJsxSpreadAttribute(node)) {
        const result = evalExpression(node.expression, env);
        env = result.env;
        analyzeEscapedValues(result.value, env);
        if (containsConsoleCapability(result.value)) recordCall(node.expression);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(jsxNode);
    return env;
  };

  evalExpression = (expression, inputEnv) => {
    if (!expression) return { env: inputEnv, value: new Set() };
    const node = unwrap(expression);
    let env = inputEnv;

    if (ts.isIdentifier(node) || ts.isThis(node) || ts.isLiteralExpression(node)) {
      return { env, value: valueFor(node, env) };
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      return { env, value: new Set([node]) };
    }
    if (ts.isClassExpression(node)) {
      return { env, value: new Set([classValueFor(node)]) };
    }
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node) ||
      ts.isJsxExpression(node)
    ) {
      return { env: evalJsxNode(node, env), value: new Set() };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const ownerResult = evalExpression(node.expression, env);
      env = ownerResult.env;
      if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        env = evalExpression(node.argumentExpression, env).env;
      }
      const property = propertyName(node);
      if (
        property === 'console' &&
        isUnshadowedGlobal(node.expression, new Set(['globalThis', 'window']))
      ) {
        return { env, value: new Set([CONSOLE_OBJECT]) };
      }
      return readMember(ownerResult.value, property, env);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = unwrap(node.expression);
      const calleeResult = evalExpression(node.expression, env);
      env = calleeResult.env;
      const wrapperName =
        ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
          ? propertyName(callee)
          : undefined;
      const targetValues = ['call', 'apply', 'bind'].includes(wrapperName)
        ? new Set(calleeResult.owner ?? [])
        : calleeResult.value;
      const argsResult = evaluateArguments(node.arguments ?? [], env);
      env = argsResult.env;

      if (ts.isCallExpression(node) && wrapperName === 'bind') {
        return {
          env,
          value: new Set([
            {
              kind: 'bound-function',
              target: new Set(targetValues),
              args: argsResult.values.slice(1),
            },
          ]),
        };
      }

      let invocationArguments = argsResult.values;
      if (wrapperName === 'call') invocationArguments = invocationArguments.slice(1);
      else if (wrapperName === 'apply') {
        invocationArguments = applyArguments(invocationArguments[1] ?? new Set());
      }
      if (ts.isCallExpression(node) && methodsIn(targetValues).size > 0) recordCall(node);

      if (ts.isNewExpression(node)) {
        const instances = [];
        for (const target of targetValues) {
          if (!isClassValue(target)) continue;
          const result = instantiateClass(target, invocationArguments ?? [], env);
          env = result.env;
          instances.push(result.value);
        }
        if (instances.length > 0) return { env, value: unionValues(...instances) };
      }

      const invocation = invokeValues(
        targetValues,
        invocationArguments ?? [],
        env,
        false,
        calleeResult.owner ?? new Set()
      );
      env = invocation.env;
      const isAmbient = invocation.ambient || !invocation.invoked;
      if (ts.isCallExpression(node) && isAmbient) {
        for (const argumentValues of argsResult.values) analyzeEscapedValues(argumentValues, env);
        if (argsResult.values.some((values) => containsConsoleCapability(values))) recordCall(node);
      }
      return { env, value: new Set() };
    }
    if (ts.isConditionalExpression(node)) {
      env = evalExpression(node.condition, env).env;
      const whenTrue = evalExpression(node.whenTrue, cloneEnv(env));
      const whenFalse = evalExpression(node.whenFalse, cloneEnv(env));
      return {
        env: mergeEnvs(whenTrue.env, whenFalse.env),
        value: unionValues(whenTrue.value, whenFalse.value),
      };
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (ts.isAssignmentOperator(operator)) {
        if (
          [
            ts.SyntaxKind.BarBarEqualsToken,
            ts.SyntaxKind.AmpersandAmpersandEqualsToken,
            ts.SyntaxKind.QuestionQuestionEqualsToken,
          ].includes(operator)
        ) {
          const unchanged = cloneEnv(env);
          const right = evalExpression(node.right, cloneEnv(env));
          assignPattern(node.left, node.right, right.value, right.env);
          return {
            env: mergeEnvs(unchanged, right.env),
            value: unionValues(valueFor(node.left, unchanged), right.value),
          };
        }
        env = evalExpression(node.left, env).env;
        const right = evalExpression(node.right, env);
        env = right.env;
        assignPattern(
          node.left,
          node.right,
          operator === ts.SyntaxKind.EqualsToken ? right.value : new Set(),
          env
        );
        return { env, value: operator === ts.SyntaxKind.EqualsToken ? right.value : new Set() };
      }
      const left = evalExpression(node.left, env);
      env = left.env;
      if (
        [
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(operator)
      ) {
        const right = evalExpression(node.right, cloneEnv(env));
        return {
          env: mergeEnvs(env, right.env),
          value: unionValues(left.value, right.value),
        };
      }
      const right = evalExpression(node.right, env);
      return {
        env: right.env,
        value: operator === ts.SyntaxKind.CommaToken ? right.value : new Set(),
      };
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const result = evalExpression(node.operand, env);
      env = result.env;
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        clearPattern(node.operand, env);
      }
      return { env, value: new Set() };
    }
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isSpreadElement(node)) {
      return evalExpression(node.expression, env);
    }
    if (ts.isTaggedTemplateExpression(node)) {
      env = evalExpression(node.tag, env).env;
      env = evalExpression(node.template, env).env;
      return { env, value: new Set() };
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) env = evalExpression(span.expression, env).env;
      return { env, value: new Set() };
    }
    if (ts.isObjectLiteralExpression(node)) {
      let objectValue = objectValues.get(node);
      if (!objectValue) {
        objectValue = { kind: 'object-value', properties: new Map() };
        objectValues.set(node, objectValue);
      }
      const properties = new Map();
      const setProperty = (name, values) => {
        if (name === undefined) {
          properties.set(
            UNKNOWN_PROPERTY,
            unionValues(properties.get(UNKNOWN_PROPERTY) ?? new Set(), values)
          );
          return;
        }
        properties.set(name, new Set(values));
      };
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          const result = evalExpression(property.initializer, env);
          env = result.env;
          setProperty(nameFor(property.name), result.value);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          if (property.objectAssignmentInitializer) {
            env = evalExpression(property.objectAssignmentInitializer, env).env;
          }
          setProperty(property.name.text, valueFor(property.name, env));
        } else if (ts.isMethodDeclaration(property)) {
          setProperty(nameFor(property.name), new Set([property]));
        } else if (ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
          setProperty(nameFor(property.name), new Set([property]));
        } else if (ts.isSpreadAssignment(property)) {
          const result = evalExpression(property.expression, env);
          env = result.env;
          const spreadProperties = new Map();
          for (const value of result.value) {
            if (!isObjectValue(value) && !isClassValue(value)) continue;
            for (const [name, values] of value.properties) {
              spreadProperties.set(
                name,
                unionValues(spreadProperties.get(name) ?? new Set(), values)
              );
            }
          }
          for (const [name, values] of spreadProperties) setProperty(name, values);
        }
      }
      objectValue.properties = properties;
      return { env, value: new Set([objectValue]) };
    }
    if (ts.isArrayLiteralExpression(node)) {
      const elements = [];
      for (const element of node.elements) {
        if (ts.isOmittedExpression(element)) {
          elements.push(new Set([EXPLICIT_UNDEFINED]));
          continue;
        }
        const result = evalExpression(
          ts.isSpreadElement(element) ? element.expression : element,
          env
        );
        env = result.env;
        if (ts.isSpreadElement(element)) {
          const arrays = [...result.value].filter(isArrayValue);
          if (arrays.length > 0) {
            const length = Math.max(...arrays.map((array) => array.elements.length));
            for (let index = 0; index < length; index += 1) {
              elements.push(
                unionValues(...arrays.map((array) => array.elements[index] ?? new Set()))
              );
            }
          }
        } else {
          elements.push(result.value);
        }
      }
      return { env, value: new Set([{ kind: 'array-value', elements }]) };
    }

    ts.forEachChild(node, (child) => {
      if (ts.isExpression(child)) env = evalExpression(child, env).env;
    });
    return { env, value: valueFor(node, env) };
  };

  const literalTruthiness = (expression) => {
    if (!expression) return true;
    const node = unwrap(expression);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
      return false;
    }
    if (ts.isNumericLiteral(node)) return Number(node.text) !== 0;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text.length > 0;
    }
    return undefined;
  };

  const mergeAbrupts = (...groups) => {
    const merged = new Map();
    for (const entry of groups.flat()) {
      const previous = merged.get(entry.type);
      if (!previous) {
        merged.set(entry.type, {
          type: entry.type,
          env: cloneEnv(entry.env),
          value: new Set(entry.value ?? []),
        });
      } else {
        previous.env = mergeEnvs(previous.env, entry.env);
        previous.value = unionValues(previous.value, entry.value ?? new Set());
      }
    }
    return [...merged.values()];
  };

  const resultWith = (normal, abrupts = []) => ({ normal, abrupts: mergeAbrupts(abrupts) });

  const applyLoopStep = (result, step) => {
    const backInputs = [];
    if (result.normal) backInputs.push(result.normal);
    backInputs.push(
      ...result.abrupts.filter((entry) => entry.type === 'continue').map((entry) => entry.env)
    );
    const backs = backInputs.map((backEnv) => step(cloneEnv(backEnv)));
    return resultWith(
      backs.length > 0 ? mergeEnvs(...backs) : null,
      result.abrupts.filter((entry) => entry.type !== 'continue')
    );
  };

  const analyzeLoop = (entryEnv, iterate, { maySkip, mayExit }) => {
    let head = cloneEnv(entryEnv);
    const exits = maySkip ? [cloneEnv(entryEnv)] : [];
    let propagated = [];
    let hasBackEdge = false;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const body = iterate(cloneEnv(head));
      const backEnvs = [];
      if (body.normal) backEnvs.push(body.normal);
      backEnvs.push(
        ...body.abrupts.filter((entry) => entry.type === 'continue').map((entry) => entry.env)
      );
      hasBackEdge ||= backEnvs.length > 0;
      exits.push(
        ...body.abrupts.filter((entry) => entry.type === 'break').map((entry) => entry.env)
      );
      if (mayExit) exits.push(...backEnvs);
      propagated = mergeAbrupts(
        propagated,
        body.abrupts.filter((entry) => !['break', 'continue'].includes(entry.type))
      );
      if (backEnvs.length === 0) break;
      const next = mergeEnvs(entryEnv, ...backEnvs);
      if (envEquals(next, head)) break;
      head = next;
    }
    if (exits.length > 0) return resultWith(mergeEnvs(...exits), propagated);
    if (hasBackEdge) {
      propagated = mergeAbrupts(propagated, [{ type: 'infinite', env: head }]);
    }
    return resultWith(null, propagated);
  };

  const analyzeSwitch = (node, inputEnv) => {
    const discriminant = evalExpression(node.expression, inputEnv);
    const entryEnv = discriminant.env;
    const clauses = node.caseBlock.clauses;
    const exits = [];
    let propagated = [];
    const hasDefault = clauses.some(ts.isDefaultClause);
    for (let start = 0; start < clauses.length; start += 1) {
      let branchEnv = cloneEnv(entryEnv);
      if (ts.isCaseClause(clauses[start])) {
        branchEnv = evalExpression(clauses[start].expression, branchEnv).env;
      }
      let branchAbrupt = [];
      for (let index = start; index < clauses.length && branchEnv; index += 1) {
        const result = analyzeStatements(clauses[index].statements, branchEnv, false);
        branchEnv = result.normal;
        branchAbrupt = mergeAbrupts(branchAbrupt, result.abrupts);
        if (result.abrupts.length > 0) break;
      }
      if (branchEnv) exits.push(branchEnv);
      exits.push(
        ...branchAbrupt.filter((entry) => entry.type === 'break').map((entry) => entry.env)
      );
      propagated = mergeAbrupts(
        propagated,
        branchAbrupt.filter((entry) => entry.type !== 'break')
      );
    }
    if (!hasDefault) exits.push(entryEnv);
    return resultWith(exits.length > 0 ? mergeEnvs(...exits) : null, propagated);
  };

  const applyFinally = (completion, finallyBlock) => {
    const inputs = [];
    if (completion.normal) inputs.push({ type: undefined, env: completion.normal });
    inputs.push(...completion.abrupts);
    const normals = [];
    let abrupts = [];
    for (const input of inputs) {
      const finalResult = analyzeStatement(finallyBlock, cloneEnv(input.env));
      if (finalResult.normal) {
        if (input.type) {
          abrupts.push({ type: input.type, env: finalResult.normal, value: input.value });
        } else {
          normals.push(finalResult.normal);
        }
      }
      abrupts = mergeAbrupts(abrupts, finalResult.abrupts);
    }
    return resultWith(normals.length > 0 ? mergeEnvs(...normals) : null, abrupts);
  };

  const analyzeStatements = (statements, inputEnv, hoistFunctions = true) => {
    let normal = inputEnv;
    let abrupts = [];
    if (hoistFunctions) {
      for (const statement of statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
          setEnvValue(normal, symbolFor(statement.name), new Set([statement]));
        }
      }
    }
    for (const statement of statements) {
      if (!normal) break;
      const result = analyzeStatement(statement, normal);
      normal = result.normal;
      abrupts = mergeAbrupts(abrupts, result.abrupts);
    }
    return resultWith(normal, abrupts);
  };

  analyzeStatement = (node, inputEnv) => {
    let env = inputEnv;
    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      return analyzeStatements(node.statements, env);
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        let values = new Set();
        if (declaration.initializer) {
          const result = evalExpression(declaration.initializer, env);
          env = result.env;
          values = result.value;
        }
        assignPattern(declaration.name, declaration.initializer, values, env);
      }
      return resultWith(env);
    }
    if (ts.isFunctionDeclaration(node)) return resultWith(env);
    if (ts.isExpressionStatement(node)) {
      return resultWith(evalExpression(node.expression, env).env);
    }
    if (ts.isIfStatement(node)) {
      env = evalExpression(node.expression, env).env;
      const thenResult = analyzeStatement(node.thenStatement, cloneEnv(env));
      const elseResult = node.elseStatement
        ? analyzeStatement(node.elseStatement, cloneEnv(env))
        : resultWith(cloneEnv(env));
      const normals = [thenResult.normal, elseResult.normal].filter(Boolean);
      return resultWith(
        normals.length > 0 ? mergeEnvs(...normals) : null,
        mergeAbrupts(thenResult.abrupts, elseResult.abrupts)
      );
    }
    if (ts.isSwitchStatement(node)) return analyzeSwitch(node, env);
    if (ts.isWhileStatement(node)) {
      env = evalExpression(node.expression, env).env;
      const truthiness = literalTruthiness(node.expression);
      if (truthiness === false) return resultWith(env);
      return analyzeLoop(
        env,
        (loopEnv) =>
          applyLoopStep(
            analyzeStatement(node.statement, loopEnv),
            (stepEnv) => evalExpression(node.expression, stepEnv).env
          ),
        { maySkip: truthiness !== true, mayExit: truthiness !== true }
      );
    }
    if (ts.isDoStatement(node)) {
      const firstBody = analyzeStatement(node.statement, env);
      const firstStepped = applyLoopStep(
        firstBody,
        (stepEnv) => evalExpression(node.expression, stepEnv).env
      );
      const truthiness = literalTruthiness(node.expression);
      const firstExits = firstStepped.abrupts
        .filter((entry) => entry.type === 'break')
        .map((entry) => entry.env);
      const propagated = firstStepped.abrupts.filter(
        (entry) => !['break', 'continue'].includes(entry.type)
      );
      if (truthiness === false) {
        if (firstStepped.normal) firstExits.push(firstStepped.normal);
        return resultWith(firstExits.length > 0 ? mergeEnvs(...firstExits) : null, propagated);
      }
      if (!firstStepped.normal) return resultWith(null, propagated);
      const rest = analyzeLoop(
        firstStepped.normal,
        (loopEnv) =>
          applyLoopStep(
            analyzeStatement(node.statement, loopEnv),
            (stepEnv) => evalExpression(node.expression, stepEnv).env
          ),
        { maySkip: truthiness !== true, mayExit: truthiness !== true }
      );
      const normals = [...firstExits, rest.normal].filter(Boolean);
      return resultWith(
        normals.length > 0 ? mergeEnvs(...normals) : null,
        mergeAbrupts(propagated, rest.abrupts)
      );
    }
    if (ts.isForStatement(node)) {
      if (node.initializer) {
        if (ts.isVariableDeclarationList(node.initializer)) {
          for (const declaration of node.initializer.declarations) {
            let values = new Set();
            if (declaration.initializer) {
              const result = evalExpression(declaration.initializer, env);
              env = result.env;
              values = result.value;
            }
            assignPattern(declaration.name, declaration.initializer, values, env);
          }
        } else {
          env = evalExpression(node.initializer, env).env;
        }
      }
      if (node.condition) env = evalExpression(node.condition, env).env;
      const truthiness = literalTruthiness(node.condition);
      if (truthiness === false) return resultWith(env);
      return analyzeLoop(
        env,
        (loopEnv) =>
          applyLoopStep(analyzeStatement(node.statement, loopEnv), (stepEnv) => {
            if (node.incrementor) stepEnv = evalExpression(node.incrementor, stepEnv).env;
            if (node.condition) stepEnv = evalExpression(node.condition, stepEnv).env;
            return stepEnv;
          }),
        { maySkip: truthiness !== true, mayExit: truthiness !== true }
      );
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      env = evalExpression(node.expression, env).env;
      return analyzeLoop(
        env,
        (loopEnv) => {
          if (ts.isVariableDeclarationList(node.initializer)) {
            for (const declaration of node.initializer.declarations) {
              assignPattern(declaration.name, undefined, new Set(), loopEnv);
            }
          } else {
            clearPattern(node.initializer, loopEnv);
          }
          return analyzeStatement(node.statement, loopEnv);
        },
        { maySkip: true, mayExit: true }
      );
    }
    if (ts.isTryStatement(node)) {
      const beforeTry = cloneEnv(env);
      const tryResult = analyzeStatement(node.tryBlock, cloneEnv(env));
      let completion = tryResult;
      if (node.catchClause) {
        const throwEntries = tryResult.abrupts.filter((entry) => entry.type === 'throw');
        // 显式 throw 已给出精确到达 catch 的状态；仅在无法定位显式 throw 时，
        // 才保守合入 try 入口/正常状态以覆盖潜在的隐式运行时异常。
        const catchCandidates = (
          throwEntries.length > 0
            ? throwEntries.map((entry) => entry.env)
            : [beforeTry, tryResult.normal]
        ).filter(Boolean);
        const preserved = tryResult.abrupts.filter((entry) => entry.type !== 'throw');
        if (catchCandidates.length > 0) {
          let catchEnv = mergeEnvs(...catchCandidates);
          if (node.catchClause.variableDeclaration) {
            assignPattern(
              node.catchClause.variableDeclaration.name,
              undefined,
              new Set(),
              catchEnv
            );
          }
          const catchResult = analyzeStatement(node.catchClause.block, catchEnv);
          const normals = [tryResult.normal, catchResult.normal].filter(Boolean);
          completion = resultWith(
            normals.length > 0 ? mergeEnvs(...normals) : null,
            mergeAbrupts(preserved, catchResult.abrupts)
          );
        } else {
          completion = resultWith(tryResult.normal, preserved);
        }
      }
      if (node.finallyBlock) completion = applyFinally(completion, node.finallyBlock);
      return completion;
    }
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
      return resultWith(null, [
        {
          type: ts.isBreakStatement(node) ? 'break' : 'continue',
          env,
        },
      ]);
    }
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
      let values = new Set();
      if (node.expression) {
        const result = evalExpression(node.expression, env);
        env = result.env;
        values = result.value;
        if (ts.isReturnStatement(node)) analyzeEscapedValues(values, env);
      }
      return resultWith(null, [
        {
          type: ts.isReturnStatement(node) ? 'return' : 'throw',
          env,
          value: values,
        },
      ]);
    }
    if (ts.isLabeledStatement(node) || ts.isWithStatement(node)) {
      return analyzeStatement(node.statement, env);
    }
    if (ts.isClassDeclaration(node)) {
      const classValue = classValueFor(node);
      if (node.name) setEnvValue(env, symbolFor(node.name), new Set([classValue]));
      for (const { member, isStatic } of classValue.fields) {
        if (!isStatic || !member.initializer) continue;
        const result = evalExpression(member.initializer, env);
        env = result.env;
        const property = nameFor(member.name);
        if (property) classValue.properties.set(property, new Set(result.value));
      }
      return resultWith(env);
    }

    ts.forEachChild(node, (child) => {
      if (ts.isStatement(child)) {
        const result = analyzeStatement(child, env);
        if (result.normal) env = result.normal;
      } else if (ts.isExpression(child)) {
        env = evalExpression(child, env).env;
      }
    });
    return resultWith(env);
  };

  const moduleResult = analyzeStatement(sourceFile, new Map());
  const moduleEnvs = [
    moduleResult.normal,
    ...moduleResult.abrupts.map((entry) => entry.env),
  ].filter(Boolean);
  const moduleEnv = moduleEnvs.length > 0 ? mergeEnvs(...moduleEnvs) : new Map();
  for (const fn of moduleFunctions) {
    if (!analyzedFunctions.has(fn)) analyzeFunction(fn, moduleEnv, undefined, true);
  }
  return [...calls.values()].sort(
    (left, right) => left.getStart(sourceFile) - right.getStart(sourceFile)
  );
}
function exemptionCommentFor(call, sourceFile, source, usedExemptions) {
  const commentRanges = ts.getLeadingCommentRanges(source, call.getFullStart()) ?? [];
  const callStart = call.getStart(sourceFile);
  const callLine = sourceFile.getLineAndCharacterOfPosition(callStart).line;

  for (const comment of [...commentRanges].reverse()) {
    if (usedExemptions.has(comment.pos)) continue;
    const commentLine = sourceFile.getLineAndCharacterOfPosition(comment.end - 1).line;
    const isAdjacent = callLine - commentLine <= 1;
    const hasOnlyTriviaBeforeCall = source.slice(comment.end, callStart).trim() === '';
    if (
      isAdjacent &&
      hasOnlyTriviaBeforeCall &&
      ALLOW_REASON_PATTERN.test(source.slice(comment.pos, comment.end))
    ) {
      usedExemptions.add(comment.pos);
      return comment.pos;
    }
  }
  return undefined;
}

function findProductionConsoleCalls(sourceRoot = WEB_SOURCE, repositoryRoot = ROOT) {
  if (!fs.existsSync(sourceRoot)) return [];
  const violations = [];
  const filePaths = collectSourceFiles(sourceRoot).filter((filePath) => {
    const relativePath = toPosix(path.relative(repositoryRoot, filePath));
    return !TEST_PATTERN.test(relativePath);
  });
  const program = ts.createProgram(filePaths, {
    jsx: ts.JsxEmit.ReactJSX,
    moduleDetection: ts.ModuleDetectionKind.Force,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
  });
  const checker = program.getTypeChecker();

  for (const filePath of filePaths) {
    const relativePath = toPosix(path.relative(repositoryRoot, filePath));
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;
    const source = sourceFile.text;
    const lines = source.split(/\r?\n/);
    const usedExemptions = new Set();

    for (const call of findConsoleCallNodes(sourceFile, checker)) {
      const callLine = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile)).line;
      if (exemptionCommentFor(call, sourceFile, source, usedExemptions) !== undefined) continue;
      violations.push({
        file: relativePath,
        line: callLine + 1,
        source: (lines[callLine] ?? '').trim(),
      });
    }
  }

  return violations;
}

function main() {
  const violations = findProductionConsoleCalls();
  if (violations.length === 0) {
    console.log('检查通过：Web 生产源码无未说明的裸 console 调用。');
    return;
  }

  console.error('检查失败：请改用 @/lib/logger；极窄基础设施出口须用 @console-ok: <理由>。');
  for (const violation of violations) {
    console.error(`  - ${violation.file}:${violation.line} ${violation.source}`);
  }
  process.exitCode = 1;
}

module.exports = { findProductionConsoleCalls };

if (require.main === module) main();
