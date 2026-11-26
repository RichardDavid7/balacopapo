package com.backspace.feature.auth

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.backspace.core.designsystem.AetherPrimaryButton
import com.backspace.core.designsystem.AetherSurfaceCard
import com.backspace.core.designsystem.LocalAetherColors
import com.backspace.core.model.InstanceInfo
import com.backspace.core.network.BackspaceRestClient
import com.backspace.core.network.SecureSessionStorage
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(
    restClient: BackspaceRestClient,
    sessionStorage: SecureSessionStorage,
    title: String,
    subtitle: String,
    instanceUrlLabel: String,
    usernameLabel: String,
    passwordLabel: String,
    connectButtonText: String,
    pendingOidcTicket: String? = null,
    onOidcTicketConsumed: () -> Unit = {},
    onAuthenticated: (instanceUrl: String, token: String) -> Unit,
) {
    val colors = LocalAetherColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var isRegisterMode by remember { mutableStateOf(false) }
    var instanceUrl by remember { mutableStateOf("https://") }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var inviteToken by remember { mutableStateOf("") }
    var instanceInfo by remember { mutableStateOf<InstanceInfo?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var oidcHandoffActive by remember { mutableStateOf(false) }
    var oidcHandoffJob by remember { mutableStateOf<Job?>(null) }

    DisposableEffect(Unit) {
        onDispose {
            oidcHandoffJob?.cancel()
            oidcHandoffJob = null
        }
    }

    LaunchedEffect(instanceUrl) {
        val trimmed = instanceUrl.trim()
        val hostPart = trimmed.removePrefix("https://").removePrefix("http://")
        if (hostPart.length < 3 || !hostPart.contains('.')) {
            instanceInfo = null
            return@LaunchedEffect
        }
        delay(450)
        runCatching {
            val normalized = SecureSessionStorage.normalizeInstanceUrl(trimmed)
            restClient.getInstanceInfo(normalized)
        }.onSuccess { info ->
            instanceInfo = info
        }.onFailure {
            instanceInfo = null
        }
    }

    LaunchedEffect(pendingOidcTicket, instanceUrl) {
        val ticket = pendingOidcTicket?.trim()
        if (ticket.isNullOrBlank()) return@LaunchedEffect
        val trimmed = instanceUrl.trim()
        val hostPart = trimmed.removePrefix("https://").removePrefix("http://")
        if (hostPart.length < 3 || !hostPart.contains('.')) return@LaunchedEffect

        oidcHandoffJob?.cancel()
        oidcHandoffJob = null
        oidcHandoffActive = false

        isLoading = true
        errorMessage = null
        runCatching {
            val normalized = SecureSessionStorage.normalizeInstanceUrl(trimmed)
            val resp = restClient.exchangeOidcTicket(normalized, ticket)
            sessionStorage.save(normalized, resp.token)
            normalized to resp.token
        }.onSuccess { (url, token) ->
            onOidcTicketConsumed()
            onAuthenticated(url, token)
        }.onFailure { err ->
            errorMessage = err.message ?: "Falha ao autenticar via OIDC"
            onOidcTicketConsumed()
        }
        isLoading = false
    }

    val currentInstanceInfo = instanceInfo
    val oidcInfo = currentInstanceInfo?.oidc
    val oidcEnabled = oidcInfo?.enabled == true
    val oidcDisplayName = oidcInfo?.displayName?.takeIf { it.isNotBlank() } ?: "SSO"
    val passwordLoginDisabled = oidcEnabled && oidcInfo?.passwordLoginDisabled == true

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bgBase)
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = colors.textPrimary,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textSecondary,
        )
        Spacer(Modifier.height(24.dp))

        AetherSurfaceCard {
            if (!passwordLoginDisabled) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = !isRegisterMode,
                        onClick = { isRegisterMode = false },
                        label = { Text(connectButtonText) },
                    )
                    FilterChip(
                        selected = isRegisterMode,
                        onClick = { isRegisterMode = true },
                        label = { Text("Criar Conta") },
                    )
                }
                Spacer(Modifier.height(12.dp))
            }

            OutlinedTextField(
                value = instanceUrl,
                onValueChange = { instanceUrl = it },
                label = { Text(instanceUrlLabel) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            if (oidcEnabled) {
                Spacer(Modifier.height(12.dp))
                if (oidcHandoffActive) {
                    Surface(
                        color = colors.accentPrimary.copy(alpha = 0.14f),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CircularProgressIndicator(
                                    color = colors.accentPrimary,
                                    strokeWidth = 2.dp,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    text = "Aguardando login no navegador...",
                                    color = colors.textPrimary,
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                            OutlinedButton(
                                onClick = {
                                    oidcHandoffJob?.cancel()
                                    oidcHandoffJob = null
                                    oidcHandoffActive = false
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Cancelar", color = colors.textPrimary)
                            }
                        }
                    }
                } else {
                    AetherPrimaryButton(
                        text = "Entrar com $oidcDisplayName",
                        enabled = !isLoading && instanceUrl.isNotBlank(),
                        onClick = {
                            oidcHandoffJob?.cancel()
                            oidcHandoffJob = scope.launch {
                                isLoading = true
                                errorMessage = null
                                val startResult = runCatching {
                                    val normalized = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
                                    val handoff = restClient.startOidcHandoff(normalized)
                                    normalized to handoff
                                }
                                isLoading = false

                                val pair = startResult.getOrElse { err ->
                                    errorMessage = err.message ?: "Falha ao iniciar login OIDC"
                                    return@launch
                                }
                                val normalized = pair.first
                                val handoff = pair.second
                                if (handoff.handoffId.isBlank() || handoff.pollToken.isBlank()) {
                                    errorMessage = "Resposta inválida do servidor OIDC"
                                    return@launch
                                }

                                val encodedHandoff = Uri.encode(handoff.handoffId)
                                val authUri = Uri.parse(
                                    "$normalized/api/auth/oidc/start?client=mobile&handoff=$encodedHandoff",
                                )
                                val opened = runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, authUri))
                                }
                                if (opened.isFailure) {
                                    errorMessage = opened.exceptionOrNull()?.message
                                        ?: "Não foi possível abrir o navegador"
                                    return@launch
                                }

                                oidcHandoffActive = true
                                val deadline = System.currentTimeMillis() + handoff.expiresInMs.coerceAtLeast(30_000L)
                                try {
                                    while (isActive && System.currentTimeMillis() < deadline) {
                                        delay(1500L)
                                        val poll = runCatching {
                                            restClient.pollOidcHandoff(
                                                instanceUrl = normalized,
                                                handoffId = handoff.handoffId,
                                                pollToken = handoff.pollToken,
                                            )
                                        }.getOrElse { err ->
                                            errorMessage = err.message ?: "Erro ao verificar login OIDC"
                                            return@launch
                                        }
                                        when (poll.status) {
                                            "ready" -> {
                                                val ticket = poll.ticket
                                                if (ticket.isNullOrBlank()) {
                                                    errorMessage = "Ticket OIDC ausente na resposta"
                                                    return@launch
                                                }
                                                runCatching {
                                                    val resp = restClient.exchangeOidcTicket(normalized, ticket)
                                                    sessionStorage.save(normalized, resp.token)
                                                    resp
                                                }.onSuccess { resp ->
                                                    onAuthenticated(normalized, resp.token)
                                                }.onFailure { err ->
                                                    errorMessage = err.message ?: "Falha ao concluir login OIDC"
                                                }
                                                return@launch
                                            }
                                            "error" -> {
                                                errorMessage = poll.error?.takeIf { it.isNotBlank() }
                                                    ?: "Falha no login OIDC"
                                                return@launch
                                            }
                                            "expired" -> {
                                                errorMessage = "Login OIDC expirado. Tente novamente."
                                                return@launch
                                            }
                                        }
                                    }
                                    if (isActive) {
                                        errorMessage = "Tempo esgotado aguardando login no navegador."
                                    }
                                } finally {
                                    oidcHandoffActive = false
                                }
                            }
                        },
                    )
                }

                if (passwordLoginDisabled) {
                    Spacer(Modifier.height(10.dp))
                    Surface(
                        color = colors.accentSky.copy(alpha = 0.14f),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = "O login nesta instância é exclusivo via $oidcDisplayName. O acesso com usuário e senha está desativado.",
                            color = colors.accentSky,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                } else {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = "ou entre com usuário e senha",
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textSecondary,
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    )
                }
            }

            if (!passwordLoginDisabled) {
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    label = { Text(usernameLabel) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (isRegisterMode) {
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = displayName,
                        onValueChange = { displayName = it },
                        label = { Text("Nome de exibição (opcional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(passwordLabel) },
                    singleLine = true,
                    visualTransformation = if (passwordVisible) {
                        VisualTransformation.None
                    } else {
                        PasswordVisualTransformation()
                    },
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }) {
                            Icon(
                                imageVector = if (passwordVisible) {
                                    Icons.Default.VisibilityOff
                                } else {
                                    Icons.Default.Visibility
                                },
                                contentDescription = if (passwordVisible) "Ocultar senha" else "Mostrar senha",
                                tint = colors.textSecondary,
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (isRegisterMode) {
                    if (currentInstanceInfo?.registrationOpen == false) {
                        Spacer(Modifier.height(10.dp))
                        Surface(
                            color = colors.accentAmber.copy(alpha = 0.14f),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = "O registro público está fechado nesta instância. É necessário informar um código de convite para criar sua conta.",
                                color = colors.accentAmber,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = inviteToken,
                        onValueChange = { inviteToken = it },
                        label = { Text("Código de convite (se exigido)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            if (!errorMessage.isNullOrBlank()) {
                Spacer(Modifier.height(12.dp))
                Text(
                    text = errorMessage!!,
                    color = colors.accentPeach,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            if (!passwordLoginDisabled) {
                Spacer(Modifier.height(18.dp))
                if (isLoading) {
                    CircularProgressIndicator(
                        color = colors.accentPrimary,
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    )
                } else {
                    AetherPrimaryButton(
                        text = if (isRegisterMode) "Criar Conta" else connectButtonText,
                        enabled = instanceUrl.isNotBlank() && username.isNotBlank() && password.isNotBlank(),
                        onClick = {
                            scope.launch {
                                isLoading = true
                                errorMessage = null
                                runCatching {
                                    val normalized = SecureSessionStorage.normalizeInstanceUrl(instanceUrl)
                                    instanceInfo = restClient.getInstanceInfo(normalized)
                                    val auth = if (isRegisterMode) {
                                        restClient.register(
                                            instanceUrl = normalized,
                                            username = username.trim(),
                                            password = password,
                                            displayName = displayName.trim().ifBlank { null },
                                            inviteToken = inviteToken.trim().ifBlank { null },
                                        )
                                    } else {
                                        restClient.login(normalized, username.trim(), password)
                                    }
                                    sessionStorage.save(normalized, auth.token)
                                    normalized to auth.token
                                }.onSuccess { (url, token) ->
                                    onAuthenticated(url, token)
                                }.onFailure { err ->
                                    errorMessage = err.message ?: "Authentication failed"
                                }
                                isLoading = false
                            }
                        },
                    )
                }
            } else if (isLoading) {
                Spacer(Modifier.height(18.dp))
                CircularProgressIndicator(
                    color = colors.accentPrimary,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                )
            }
        }
    }
}
