// Tailwind v4 PostCSS-плагин. Без этого файла CSS не процессится и
// `@import "tailwindcss"` в globals.css не разворачивается, страницы
// рендерятся без стилей.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
