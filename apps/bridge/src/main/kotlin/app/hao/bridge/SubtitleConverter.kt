package app.hao.bridge

object SubtitleConverter {
    fun toWebVtt(input: String): String {
        val text = input.removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n').trim()
        if (text.startsWith("WEBVTT", ignoreCase = true)) return "$text\n"
        if (text.lineSequence().any { it.startsWith("Dialogue:", ignoreCase = true) }) return assToWebVtt(text)
        return srtToWebVtt(text)
    }

    private fun srtToWebVtt(text: String): String {
        val body = text.split(Regex("\n{2,}"))
            .mapNotNull { block ->
                val lines = block.lines().filter(String::isNotBlank).toMutableList()
                if (lines.firstOrNull()?.all(Char::isDigit) == true) lines.removeAt(0)
                val timing = lines.firstOrNull() ?: return@mapNotNull null
                if (!timing.contains("-->")) return@mapNotNull null
                lines[0] = timing.replace(Regex("(\\d{2}:\\d{2}:\\d{2}),([0-9]{3})"), "$1.$2")
                lines.joinToString("\n")
            }
            .joinToString("\n\n")
        require(body.isNotBlank()) { "Subtitle file did not contain supported cues" }
        return "WEBVTT\n\n$body\n"
    }

    private fun assToWebVtt(text: String): String {
        val cues = text.lineSequence().mapNotNull { line ->
            if (!line.startsWith("Dialogue:", ignoreCase = true)) return@mapNotNull null
            val fields = line.substringAfter(':').trim().split(',', limit = 10)
            if (fields.size < 10) return@mapNotNull null
            val start = assTimestamp(fields[1]) ?: return@mapNotNull null
            val end = assTimestamp(fields[2]) ?: return@mapNotNull null
            val caption = fields[9]
                .replace(Regex("\\{[^}]*}"), "")
                .replace("\\N", "\n")
                .replace("\\n", "\n")
                .trim()
            if (caption.isBlank()) null else "$start --> $end\n$caption"
        }.toList()
        require(cues.isNotEmpty()) { "Subtitle file did not contain supported cues" }
        return "WEBVTT\n\n${cues.joinToString("\n\n")}\n"
    }

    private fun assTimestamp(value: String): String? {
        val match = Regex("(\\d+):(\\d{2}):(\\d{2})[.](\\d{1,3})").matchEntire(value.trim()) ?: return null
        val hours = match.groupValues[1].padStart(2, '0')
        val fraction = match.groupValues[4].padEnd(3, '0').take(3)
        return "$hours:${match.groupValues[2]}:${match.groupValues[3]}.$fraction"
    }
}
