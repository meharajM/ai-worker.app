import React, { useEffect, useRef } from 'react'

interface VoiceVisualizerProps {
    audioLevel: number
    isListening: boolean
}

export function VoiceVisualizer({ audioLevel, isListening }: VoiceVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let animationId: number
        let phase = 0

        const draw = () => {
            if (!isListening) {
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                return
            }

            const width = canvas.width
            const height = canvas.height
            const centerY = height / 2

            ctx.clearRect(0, 0, width, height)

            // ChatGPT-style blob animation
            // Using 4 blobs with different phases
            const baseRadius = 30
            const maxExpansion = 20 * (0.2 + audioLevel * 1.5) // React to audio

            ctx.globalCompositeOperation = 'screen'

            const colors = [
                'rgba(255, 255, 255, 0.8)', // White center
                'rgba(190, 190, 255, 0.5)', // Blue tint
                'rgba(190, 255, 190, 0.5)', // Green tint
                'rgba(255, 255, 255, 0.3)'  // Outer glow
            ]

            for (let i = 0; i < 4; i++) {
                ctx.beginPath()
                const offset = (i * Math.PI) / 2
                const t = phase + offset

                // Blob shape math
                const blobRadius = baseRadius + Math.sin(t * 2) * 5 + maxExpansion
                const x = width / 2 + Math.cos(t) * 5
                const y = centerY + Math.sin(t * 1.5) * 5

                const gradient = ctx.createRadialGradient(x, y, 0, x, y, blobRadius * 1.5)
                gradient.addColorStop(0, colors[i])
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

                ctx.fillStyle = gradient
                ctx.arc(x, y, blobRadius * 2, 0, Math.PI * 2)
                ctx.fill()
            }

            phase += 0.05
            animationId = requestAnimationFrame(draw)
        }

        draw()

        return () => {
            cancelAnimationFrame(animationId)
        }
    }, [isListening, audioLevel])

    return (
        <canvas
            ref={canvasRef}
            width={200}
            height={100}
            className="w-full h-full"
        />
    )
}
