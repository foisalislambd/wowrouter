export default function localFont(options: { variable?: string; src?: unknown; display?: string }) {
  return { variable: options.variable ?? '', className: options.variable ?? '' };
}
