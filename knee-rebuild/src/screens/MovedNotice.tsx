import { useRoute } from '../app/router.ts'
import { Button } from '../components/Button.tsx'
import { movedTo } from '../rules/host.ts'
import { movedView } from './MovedNotice.helpers.ts'
import { openSettingsAtExport } from './Settings.tsx'

/** The page's own host, read once: it doesn't change while the page runs. */
const target = typeof window === 'undefined' ? null : movedTo(window.location.hostname)

/**
 * On the old address only (M-D1; PROGRAM-QUESTIONS 238, 239): the app has moved, and how to carry
 * the log across. Not a modal and not dismissible: it stays until the old icon is deleted. Words
 * carry it, not color. Never above a session in progress.
 */
export function MovedNotice() {
  const route = useRoute()
  if (target === null || route.name === 'session') return null
  const view = movedView(target, route.name === 'welcome')
  return (
    <aside aria-label="New address" className="mx-auto flex max-w-[36rem] flex-col gap-2 px-4 pt-4 text-small text-on-dark">
      <p>{view.lead}</p>
      {view.steps.length > 0 ? (
        <details className="text-on-dark-dim">
          <summary className="tap flex cursor-pointer items-center text-on-dark-muted">How to move</summary>
          <ol className="flex list-decimal flex-col gap-1 pl-6">
            {view.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        {view.showExport ? (
          <Button variant="primary" onClick={openSettingsAtExport}>
            Export JSON
          </Button>
        ) : null}
        <a href={view.link.href} target="_blank" rel="noreferrer" className="tap inline-flex items-center text-small text-on-dark-dim underline underline-offset-4">
          {view.link.label}
        </a>
      </div>
    </aside>
  )
}
