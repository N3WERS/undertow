import { useLayoutEffect, type RefObject } from 'react'

/**
 * Запоминает, из какой точки панель «вылетела»: считает положение кнопки
 * относительно самой панели и задаёт transform-origin. Благодаря этому
 * окно раскрывается из своей иконки в нижней панели, как из дока.
 */
export function usePanelOrigin(
  ref: RefObject<HTMLElement | null>,
  triggerSelector: string,
  active = true
) {
  useLayoutEffect(() => {
    if (!active) return
    const el = ref.current
    const trigger = document.querySelector(triggerSelector)
    if (!el || !trigger) return

    // анимация уже могла начать масштабировать панель: на миг отключаем её,
    // чтобы измерить финальную геометрию, а не уменьшенный кадр
    const prevAnimation = el.style.animation
    el.style.animation = 'none'
    const panel = el.getBoundingClientRect()
    el.style.animation = prevAnimation

    const btn = trigger.getBoundingClientRect()
    if (!panel.width || !panel.height) return

    const centerX = btn.left + btn.width / 2
    const centerY = btn.top + btn.height / 2
    // считаем от правого и нижнего края: панели привязаны к ним, поэтому
    // origin не съезжает, когда подгружается список и меняется высота
    const right = panel.right - centerX
    const below = centerY - panel.bottom
    el.style.setProperty('--panel-origin-right', `${right.toFixed(1)}px`)
    el.style.setProperty('--panel-origin-below', `${Math.max(0, below).toFixed(1)}px`)
  }, [active, ref, triggerSelector])
}
