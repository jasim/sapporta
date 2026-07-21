# Compact Interface Design Guideline

## Design language

Design compact, task-first interfaces for people doing operational work. Each page should read as one composed workspace: a shallow context header, one dominant work surface, and supporting information that becomes quieter as it becomes less consequential. Favor density without crowding, using alignment, typography, and a restrained spacing scale before introducing cards or decoration. Let content determine the size of its containers. Reserve strong color, contrast, scale, and dark surfaces for the current action, active state, or an exceptional condition. The first viewport should contain useful work—not merely orientation, summaries, or empty framing.

The result should feel calm and precise: more like a well-organized instrument panel than a collection of independent cards.

## Structural rules

- Preserve the reading order: page context → primary action → primary content → supporting information.
- Give each page one dominant work surface and one primary action. Show that action once, where its scope is clearest.
- Keep page headers shallow. Routine titles orient the user; they do not behave like landing-page headlines.
- Let a collection own its search, filters, sorting, export, pagination, and collection-level creation.
- Keep the principal work—table, form, queue, report, or related collection—close to the page or record header.
- Order metadata by consequence. State, ownership, deadlines, and progress precede reference details.

## Visual system

- Use a restrained spacing scale such as `4, 8, 12, 16, 24, 32`.
- Keep ordinary desktop controls approximately `36–40px` high.
- Group with alignment, spacing, and typography before adding a bordered surface.
- Give every visible boundary a semantic purpose. Avoid nested cards and repeated frames.
- Prefer borders to shadows for permanent structure. Use shadows for elevation and temporary layers.
- Size containers to their content. Introduce a fixed-height scrolling region only after the content reaches a useful viewport limit.
- Keep radii, borders, and surface treatments consistent among components with the same role.

## Characteristic treatments

- Present summary metrics as a compact strip near the content they describe. Metrics support an actionable worklist; they do not compete with it.
- Combine related metadata into one compact strip, definition list, or structured panel rather than several equal cards.
- Reserve saturated or dark panels for urgency, active selection, or one recommended next step.
- Keep collection toolbars compact and integrated with active filters.
- Use dense, scannable rows unless multiline content, secondary labels, touch interaction, or another concrete need requires more height.
- Keep empty states concise and size their containers to the message.
- Group form fields by decision or workflow step. Keep helper text subordinate and form actions in one consistent location.

## Review checks

A page is ready when:

- A three-second glance reveals its identity, current task, and primary action.
- A squint test reveals one dominant region.
- The primary action appears once.
- Every card or border expresses a distinct grouping.
- Short content produces short containers.
- Supporting metrics remain subordinate to actionable content.
- The first viewport contains useful work.
