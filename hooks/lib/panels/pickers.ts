import type { IndexPanel } from '../../../types'
import { MODEL_FAMILIES, familyLabel, fmtNum, modelFamily, modelLabel } from '../format'
import type { PanelView, RowItem } from '../panels'
import { EFFORTS, MIDDLE_WIDTH, ROW_GAP } from './constants'
import { padTo, type Kit } from './kit'

export function pickerLines(panel: IndexPanel, view: PanelView, kit: Kit): RowItem[][] {
  const { cfg, choices } = view
  const { note, title, middle } = kit
  const choice = (text: string, pick: string, isCurrent: boolean): RowItem =>
    isCurrent ? { text, color: cfg.colors.model } : { text, color: cfg.colors.icons, pick }
  const middleEndingWith = (items: RowItem[], end: RowItem) => [...padTo(items, MIDDLE_WIDTH - ROW_GAP - end.text.length), end]
  const recache = note(`may re-cache ${view.contextTokens ? `about ${fmtNum(view.contextTokens)} tokens` : 'the conversation'}`)

  if (panel === 'harness') {
    if (!view.harnesses) return []
    return [[title('Open'), ...middle(view.harnesses.map(h => choice(h.label, h.name, false))), note('in a new tab')]]
  }
  if (panel === 'effort') {
    const levels = [
      ...EFFORTS.map(level => choice(level, level, level === choices.effort)),
      note('·'),
      { text: 'ultracode', color: view.ultracode ? cfg.colors.model : cfg.colors.icons, pick: 'ultracode' },
    ]
    return [[title('Effort'), ...middleEndingWith(levels, choice('default', 'default', choices.effortIsDefault)), recache]]
  }
  const models = MODEL_FAMILIES.map(f => {
    const id = view.modelIds[f]
    return choice(id ? modelLabel(id) : familyLabel(f), f, modelFamily(choices.model) === f)
  })
  return [[title('Model'), ...middleEndingWith(models, choice('default', 'default', choices.modelIsDefault)), recache]]
}
