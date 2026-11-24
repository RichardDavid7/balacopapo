package com.backspace.feature.chat

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import com.backspace.core.designsystem.AetherTheme

private val TOKEN_REGEX = Regex(
    """(https?://[^\s<>]+)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(~~[^~\n]+~~)|(\|\|[^|\n]+\|\|)|(@[a-zA-Z0-9_.-]+)""",
)

@Suppress("DEPRECATION")
@Composable
fun MarkdownMessageText(
    text: String,
    edited: Boolean,
    modifier: Modifier = Modifier,
) {
    val colors = AetherTheme.colors
    val context = LocalContext.current
    var spoilersRevealed by remember(text) { mutableStateOf(false) }

    val annotated = remember(text, edited, spoilersRevealed) {
        buildAnnotatedString {
            var cursor = 0
            for (match in TOKEN_REGEX.findAll(text)) {
                val start = match.range.first
                if (start > cursor) {
                    append(text.substring(cursor, start))
                }
                val raw = match.value
                when {
                    match.groups[1] != null -> { // URL
                        val s = length
                        append(raw)
                        addStyle(
                            SpanStyle(
                                color = colors.accentSky,
                                textDecoration = TextDecoration.Underline,
                            ),
                            s,
                            length,
                        )
                        addStringAnnotation("URL", raw, s, length)
                    }
                    match.groups[2] != null -> { // **bold**
                        val inner = raw.removeSurrounding("**")
                        val s = length
                        append(inner)
                        addStyle(SpanStyle(fontWeight = FontWeight.Bold), s, length)
                    }
                    match.groups[3] != null -> { // *italic*
                        val inner = raw.removeSurrounding("*")
                        val s = length
                        append(inner)
                        addStyle(SpanStyle(fontStyle = FontStyle.Italic), s, length)
                    }
                    match.groups[4] != null -> { // `code`
                        val inner = raw.removeSurrounding("`")
                        val s = length
                        append(inner)
                        addStyle(
                            SpanStyle(
                                fontFamily = FontFamily.Monospace,
                                background = colors.bgBase,
                                color = colors.accentMint,
                            ),
                            s,
                            length,
                        )
                    }
                    match.groups[5] != null -> { // ~~strike~~
                        val inner = raw.removeSurrounding("~~")
                        val s = length
                        append(inner)
                        addStyle(SpanStyle(textDecoration = TextDecoration.LineThrough), s, length)
                    }
                    match.groups[6] != null -> { // ||spoiler||
                        val inner = raw.removeSurrounding("||")
                        val s = length
                        append(if (spoilersRevealed) inner else "████████")
                        addStyle(
                            SpanStyle(
                                background = colors.bgElevated,
                                color = if (spoilersRevealed) colors.textPrimary else colors.textTertiary,
                            ),
                            s,
                            length,
                        )
                        addStringAnnotation("SPOILER", "1", s, length)
                    }
                    match.groups[7] != null -> { // @mention
                        val s = length
                        append(raw)
                        addStyle(
                            SpanStyle(
                                color = colors.accentPrimary,
                                background = colors.accentPrimary.copy(alpha = 0.18f),
                                fontWeight = FontWeight.SemiBold,
                            ),
                            s,
                            length,
                        )
                    }
                    else -> append(raw)
                }
                cursor = match.range.last + 1
            }
            if (cursor < text.length) {
                append(text.substring(cursor))
            }
            if (edited) {
                val s = length
                append(" (editado)")
                addStyle(SpanStyle(color = colors.textTertiary), s, length)
            }
        }
    }

    ClickableText(
        text = annotated,
        style = MaterialTheme.typography.bodyMedium.copy(color = colors.textPrimary),
        modifier = modifier,
        onClick = { offset ->
            val urlAnn = annotated.getStringAnnotations("URL", offset, offset).firstOrNull()
            if (urlAnn != null) {
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(urlAnn.item))) }
                return@ClickableText
            }
            val spoilerAnn = annotated.getStringAnnotations("SPOILER", offset, offset).firstOrNull()
            if (spoilerAnn != null) {
                spoilersRevealed = !spoilersRevealed
            }
        },
    )
}
