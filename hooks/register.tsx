import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'commander'
const BS = String.fromCharCode(92)
const NB = String.fromCharCode(160)

const BG = '#020b24'
const PANEL = '#04143d'
const LINE = '#1f8fff'
const HEAD_BG = '#0b2a6b'
const AMBER = '#ffd24a'
const CYAN = '#3fd9e8'
const TEXT = '#bcd8ff'
const DIM = '#4f6fa3'
const SEL_BG = '#0e9aa7'
const FKEY_BG = '#14b8c4'

const rootAtom = atom({ plugin: 'commander', key: 'root' } as const, '', {
  shape: 'root-1',
})
const openAtom = atom({ plugin: 'commander', key: 'open' } as const, '[]', {
  shape: 'open-1',
})
const selAtom = atom({ plugin: 'commander', key: 'sel' } as const, '', {
  shape: 'sel-1',
})

const WRITERS = new Set(['Write', 'Edit', 'NotebookEdit'])
const CAP = 400
const MAX_DEPTH = 10

const norm = (p: string) => p.split('/').join(BS)
const low = (p: string) => norm(p).toLowerCase()
const join = (dir: string, name: string) =>
  dir.endsWith(BS) ? dir + name : dir + BS + name

const parent = (p: string) => {
  const clean = p.endsWith(BS) && p.length > 3 ? p.slice(0, -1) : p
  const i = clean.lastIndexOf(BS)
  if (i <= 2) return clean.slice(0, 3)
  return clean.slice(0, i)
}

const padR = (s: string, n: number) =>
  s.length >= n ? s : s + NB.repeat(n - s.length)
const padL = (s: string, n: number) =>
  s.length >= n ? s : NB.repeat(n - s.length) + s
const clip = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + '~' : padR(s, n)

const fmtSize = (n: number) =>
  n >= 1048576
    ? (n / 1048576).toFixed(1) + NB + 'M'
    : n >= 1024
      ? (n / 1024).toFixed(1) + NB + 'K'
      : String(n)

const two = (n: number) => (n < 10 ? '0' + n : String(n))
const fmtDate = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
}

type Row = {
  name: string
  path: string
  isDir: boolean
  size: number
  mtimeMs: number
  prefix: string
  isOpen: boolean
}

const SHORTCUTS: { label: string; path: string }[] = [
  { label: 'C:', path: 'C:' + BS },
  { label: 'G:', path: 'G:' + BS },
  { label: 'Playground', path: 'G:' + BS + 'My Drive' + BS + 'Playgound' },
  {
    label: 'Children',
    path:
      'G:' + BS + 'My Drive' + BS + 'Playgound' + BS + 'ets2-prototype-workspace' + BS + 'children',
  },
]

const ancestorsOf = (root: string, file: string) => {
  const r = low(root).replace(/\\+$/, '')
  const f = low(file)
  if (!f.startsWith(r + BS)) return null
  const parts = f.slice(r.length + 1).split(BS)
  const out: string[] = []
  let acc = r
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc + BS + parts[i]
    out.push(acc)
  }
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nc',
      description: 'Norton Commander style file tree',
    })
    const cwd = await $.session.cwd()
    await update($, rootAtom, cur => cur || norm(cwd))
    void $.ui.open({ id: PANE, title: 'Commander' })
    return next(e)
  })

  on('command.run', { command: 'nc' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Commander' })
    return { text: 'Commander opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (WRITERS.has(e.tool)) {
      const arg = e as unknown as { file_path?: string; notebook_path?: string }
      const raw = arg.file_path ?? arg.notebook_path
      if (raw) {
        const file = norm(raw)
        let root = await read($, rootAtom)
        let anc = root ? ancestorsOf(root, file) : null
        if (anc === null) {
          root = parent(file)
          await update($, rootAtom, () => root)
          anc = []
        }
        const add = anc
        await update($, openAtom, cur => {
          const set = new Set<string>(JSON.parse(cur))
          for (const a of add) set.add(a)
          return JSON.stringify([...set])
        })
        await update($, selAtom, () => file)
      }
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const root = await read($, rootAtom)
    const openList = await read($, openAtom)
    const sel = await read($, selAtom)
    const openSet = new Set<string>(JSON.parse(openList))
    const cols =
      (e as unknown as { props?: { bodyColumns?: number } }).props?.bodyColumns ?? 60
    const sizeW = 8
    const dateW = 10
    const nameW = Math.max(16, cols - sizeW - dateW - 8)

    const reveal = (p: string) => {
      void $.tool
        .call({ tool: 'mcp__ccd_host__reveal_path', path: p } as never)
        .catch(() => $.ui.toast('Could not open ' + p))
    }
    const toggle = (path: string) =>
      void update($, openAtom, cur => {
        const set = new Set<string>(JSON.parse(cur))
        const k = low(path)
        if (set.has(k)) set.delete(k)
        else set.add(k)
        return JSON.stringify([...set])
      })
    const select = (path: string) => void update($, selAtom, () => path)
    const setRoot = (path: string) => {
      void update($, rootAtom, () => path)
      void update($, selAtom, () => '')
    }

    const rows: Row[] = []
    let failed = false
    const walk = async (dir: string, ancestors: boolean[]) => {
      if (rows.length >= CAP || ancestors.length >= MAX_DEPTH) return
      let list
      try {
        list = await $.fs.list(dir)
      } catch {
        if (ancestors.length === 0) failed = true
        return
      }
      const dirs = list
        .filter(x => x.kind === 'dir')
        .sort((a, b) => a.name.localeCompare(b.name))
      const files = list
        .filter(x => x.kind !== 'dir')
        .sort((a, b) => a.name.localeCompare(b.name))
      const items = [...dirs, ...files]
      for (let i = 0; i < items.length; i++) {
        if (rows.length >= CAP) return
        const x = items[i]
        const last = i === items.length - 1
        const full = join(dir, x.name)
        const isDir = x.kind === 'dir'
        const isOpen = isDir && openSet.has(low(full))
        const prefix =
          ancestors.map(a => (a ? '│' + NB + NB : NB + NB + NB)).join('') +
          (last ? '└─' : '├─')
        rows.push({
          name: x.name,
          path: full,
          isDir,
          size: x.size,
          mtimeMs: x.mtimeMs,
          prefix,
          isOpen,
        })
        if (isOpen) await walk(full, [...ancestors, !last])
      }
    }
    if (root) await walk(root, [])

    await Promise.all(
      rows
        .filter(r => r.isDir)
        .map(async r => {
          try {
            r.mtimeMs = (await $.fs.stat(r.path)).mtimeMs
          } catch {
            r.mtimeMs = 0
          }
        }),
    )

    const selRow = rows.find(r => low(r.path) === low(sel))
    const fileCount = rows.filter(r => !r.isDir).length
    const dirCount = rows.length - fileCount

    const fkey = (k: string, label: string, onPress: (p: { surface: string }) => void) => (
      <Button key={'f' + k} plain onPress={onPress as never}>
        <Text color="#ffffff" backgroundColor={BG} mono>
          {k}
        </Text>
        <Text color="#001b33" backgroundColor={FKEY_BG} mono>
          {NB + padR(label, 9)}
        </Text>
      </Button>
    )

    return (
      <Box flexDirection="column" backgroundColor={BG} padding={1} gap={1}>
        <Box gap={1}>
          {SHORTCUTS.map(s => (
            <Button key={'go:' + s.label} plain onPress={() => setRoot(s.path)}>
              <Text color={CYAN} backgroundColor={HEAD_BG} mono>
                {NB + s.label + NB}
              </Text>
            </Button>
          ))}
        </Box>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={LINE}
          backgroundColor={PANEL}
        >
          <Box paddingX={1}>
            <Text color={CYAN} mono weight="bold">
              {root}
            </Text>
          </Box>
          <Box backgroundColor={HEAD_BG} paddingX={1}>
            <Text color={AMBER} mono weight="bold">
              {padR('Name', nameW + 3) + padL('Size', sizeW) + NB + padR('Date', dateW)}
            </Text>
          </Box>
          <Box paddingX={1}>
            <Button key="up" plain onPress={() => setRoot(parent(root))}>
              <Text color={AMBER} mono>
                {'↰' + NB + NB + '..'}
              </Text>
              <Text color={DIM} mono>
                {NB + NB + '<UP>'}
              </Text>
            </Button>
          </Box>
          {failed && (
            <Text color={DIM} mono>
              {NB + 'cannot read folder'}
            </Text>
          )}
          {rows.map(r => {
            const isSel = low(r.path) === low(sel)
            const bg = isSel ? SEL_BG : PANEL
            const icon = r.isDir ? (r.isOpen ? '📂' : '📁') : '📄'
            return (
              <Box key={'row:' + r.path} backgroundColor={bg} paddingX={1}>
                <Button
                  key={r.path}
                  plain
                  onPress={() => {
                    if (r.isDir) {
                      select(r.path)
                      toggle(r.path)
                    } else if (isSel) {
                      reveal(r.path)
                    } else {
                      select(r.path)
                    }
                  }}
                >
                  <Text color={DIM} backgroundColor={bg} mono>
                    {r.prefix}
                  </Text>
                  <Text backgroundColor={bg} mono>
                    {icon + NB}
                  </Text>
                  <Text
                    color={isSel ? '#ffffff' : r.isDir ? AMBER : TEXT}
                    backgroundColor={bg}
                    mono
                    weight={r.isDir ? 'semibold' : 'regular'}
                  >
                    {clip(r.name, Math.max(8, nameW - r.prefix.length - 2))}
                  </Text>
                  <Text color={isSel ? '#ffffff' : DIM} backgroundColor={bg} mono>
                    {padL(r.isDir ? '<DIR>' : fmtSize(r.size), sizeW) +
                      NB +
                      padR(fmtDate(r.mtimeMs), dateW)}
                  </Text>
                </Button>
              </Box>
            )
          })}
          <Box backgroundColor={HEAD_BG} paddingX={1}>
            <Text color={TEXT} mono>
              {selRow
                ? selRow.name + NB + NB + (selRow.isDir ? '<DIR>' : fmtSize(selRow.size))
                : fileCount + ' files, ' + dirCount + ' dirs'}
            </Text>
          </Box>
        </Box>
        <Box gap={1}>
          {fkey('F3', 'Show', () => reveal(selRow ? selRow.path : root))}
          {fkey('F4', 'Enter', () => {
            if (selRow && selRow.isDir) setRoot(selRow.path)
          })}
          {fkey('F5', 'CopyPath', press =>
            $.ui.copy({ text: selRow ? selRow.path : root, surface: press.surface }),
          )}
          {fkey('F10', 'Close', () => $.ui.close({ id: PANE }))}
        </Box>
      </Box>
    )
  })
}
