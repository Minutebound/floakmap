/**
 * Ambient declarations for non-code imports.
 *
 * Next's bundler handles `import 'x.css'` natively, but TypeScript only knows
 * about `*.module.css` (declared by next/types). With
 * `noUncheckedSideEffectImports` on, a plain stylesheet import — ours in
 * layout.tsx, MapLibre's in MapView.tsx — resolves to nothing and errors.
 *
 * `unknown` rather than `any`: a side-effect import has no usable value, and
 * this way `import styles from './x.css'` stays an error instead of silently
 * typing as any.
 */
declare module '*.css' {
  const stylesheet: unknown
  export default stylesheet
}

declare module '*.scss' {
  const stylesheet: unknown
  export default stylesheet
}