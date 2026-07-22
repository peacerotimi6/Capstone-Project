output "aks_cluster_name" {
  description = "Name of the AKS cluster"
  value       = azurerm_kubernetes_cluster.main.name
}

output "resource_group_name" {
  description = "Resource group containing the AKS cluster"
  value       = azurerm_resource_group.main.name
}

output "acr_login_server" {
  description = "ACR login server (N/A if not using ACR)"
  value       = var.acr_name != "" ? azurerm_container_registry.main[0].login_server : "N/A"
}

output "application_insights_connection_string" {
  description = "Application Insights connection string for app telemetry"
  value       = azurerm_application_insights.main.connection_string
  sensitive   = true
}

output "postgres_fqdn" {
  description = "PostgreSQL Flexible Server hostname"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

# ── Key Vault CSI outputs ────────────────────────────────────────────────────
# These feed into the SecretProviderClass manifest at deploy time so pods can
# pull secrets from Key Vault via the managed identity the AKS addon provisioned.

output "key_vault_name" {
  description = "Name of the Key Vault holding runtime secrets"
  value       = azurerm_key_vault.main.name
}

output "tenant_id" {
  description = "Azure AD tenant ID (needed by the SecretProviderClass)"
  value       = data.azurerm_client_config.current.tenant_id
}
output "csi_user_assigned_identity_client_id" {
  value = try(
    azurerm_kubernetes_cluster.main.key_vault_secrets_provider[0].secret_identity[0].client_id,
    ""
  )
}

