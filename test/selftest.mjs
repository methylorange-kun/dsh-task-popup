import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(here)

// --- manifest ---------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(manifest.name, 'dsh-task-popup')
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(manifest.dsh.client.platform, 'web')
assert.equal(manifest.dsh.client.immediately, true)
assert.ok(Array.isArray(manifest.dsh.client.inject))
assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))

// --- host half --------------------------------------------------------------
const host = await import(pathToFileURL(path.join(root, 'index.js')).href)
assert.equal(host.name, 'task-popup')
assert.equal(typeof host.apply, 'function')

// --- browser half -----------------------------------------------------------
let captured = null
const window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
}
vm.runInNewContext(fs.readFileSync(path.join(root, 'client.js'), 'utf8'), { window, console })

assert.ok(captured, 'client factory was not registered')
assert.equal(captured.id, 'dsh-task-popup')

const React = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useRef: () => ({ current: null }),
  useState: () => [null, () => {}],
  useEffect: () => {},
}
const module = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
assert.equal([...module.inject].join(','), 'slots,locale')

const registrations = []
const ctx = {
  effect(fn) {
    return fn()
  },
  locale: {
    register() {
      return () => {}
    },
  },
  slots: {
    inject(owner, register) {
      assert.equal(owner, 'shell.overlay')
      return register()
    },
    register(definition, component) {
      registrations.push({ definition, component })
      return () => {}
    },
  },
}
module.apply(ctx)
assert.equal(registrations.length, 1)
assert.equal(registrations[0].definition.name, 'shell.overlay')
assert.equal(registrations[0].definition.locale, 'taskPopup')
assert.equal(typeof registrations[0].component, 'function')

console.log('dsh-task-popup selftest: ok')
