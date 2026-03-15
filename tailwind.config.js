/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif']
            },
            borderRadius: {
                input: 'var(--radius-input)',
                tile: 'var(--radius-tile)',
            },
            transitionDuration: {
                fast: 'var(--duration-fast)',
                normal: 'var(--duration-normal)',
                slow: 'var(--duration-slow)',
            },
            boxShadow: {
                glass: 'var(--shadow-glass)',
            }
        }
    },
    plugins: []
}
