package com.backspace.feature.settings

import android.app.LocaleManager
import android.content.Context
import android.os.Build
import android.os.LocaleList
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors

private const val UI_PREFS_NAME = "backspace_ui_prefs"
private const val KEY_APP_LANGUAGE = "app_language"
private const val KEY_UI_SCALE = "ui_scale"

private data class LanguageOption(
    val tag: String,
    val label: String,
)

private val SupportedLanguages = listOf(
    LanguageOption(tag = "", label = "Automático do sistema"),
    LanguageOption(tag = "pt-BR", label = "Português (Brasil)"),
    LanguageOption(tag = "en", label = "English"),
    LanguageOption(tag = "de", label = "Deutsch"),
    LanguageOption(tag = "ru", label = "Русский"),
    LanguageOption(tag = "zh-CN", label = "简体中文"),
)

private val UiScaleOptions = listOf(
    0.85f to "85%",
    1.00f to "100%",
    1.15f to "115%",
    1.30f to "130%",
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AppearanceSettingsSubScreen() {
    val colors = LocalAetherColors.current
    val context = LocalContext.current
    val uiPrefs = remember(context) {
        context.getSharedPreferences(UI_PREFS_NAME, Context.MODE_PRIVATE)
    }

    var selectedLanguage by remember {
        mutableStateOf(uiPrefs.getString(KEY_APP_LANGUAGE, "").orEmpty())
    }
    var selectedScale by remember {
        mutableFloatStateOf(uiPrefs.getFloat(KEY_UI_SCALE, 1.0f))
    }
    var languageStatusMsg by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // ── Idioma ──
        AetherSurfaceCard {
            Text(
                text = "Idioma do Aplicativo",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Escolha o idioma de exibição da interface.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SupportedLanguages.forEach { option ->
                    FilterChip(
                        selected = selectedLanguage == option.tag,
                        onClick = {
                            selectedLanguage = option.tag
                            uiPrefs.edit().putString(KEY_APP_LANGUAGE, option.tag).apply()
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                val localeManager = context.getSystemService(LocaleManager::class.java)
                                localeManager?.applicationLocales = if (option.tag.isEmpty()) {
                                    LocaleList.getEmptyLocaleList()
                                } else {
                                    LocaleList.forLanguageTags(option.tag)
                                }
                                languageStatusMsg = "Idioma aplicado: ${option.label}."
                            } else {
                                languageStatusMsg = "Preferência salva (${option.label}). Em Android anterior ao 13, o idioma segue o sistema."
                            }
                        },
                        label = { Text(option.label) },
                    )
                }
            }

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Nota: a troca imediata de idioma por aplicativo requer Android 13 (API 33) ou superior.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
            }

            if (!languageStatusMsg.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    text = languageStatusMsg!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.accentMint,
                )
            }
        }

        // ── Escala da Interface ──
        AetherSurfaceCard {
            Text(
                text = "Escala da Interface",
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Ajuste o tamanho dos textos e elementos visuais (${(selectedScale * 100).toInt()}%).",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(10.dp))

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                UiScaleOptions.forEach { (scaleValue, label) ->
                    val isSelected = kotlin.math.abs(selectedScale - scaleValue) < 0.01f
                    FilterChip(
                        selected = isSelected,
                        onClick = {
                            selectedScale = scaleValue
                            uiPrefs.edit().putFloat(KEY_UI_SCALE, scaleValue).apply()
                        },
                        label = { Text(label) },
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            Text(
                text = "Pré-visualização do texto na escala atual (${(selectedScale * 100).toInt()}%).",
                fontSize = (14f * selectedScale).sp,
                color = colors.textPrimary,
            )

            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = {
                    selectedScale = 1.0f
                    uiPrefs.edit().putFloat(KEY_UI_SCALE, 1.0f).apply()
                },
                enabled = kotlin.math.abs(selectedScale - 1.0f) >= 0.01f,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Redefinir para 100%", color = colors.accentSky)
            }
        }

        Spacer(Modifier.height(16.dp))
    }
}
