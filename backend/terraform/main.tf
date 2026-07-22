terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  backend "azurerm" {
    use_azuread_auth = true
  }
}


provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}


data "azurerm_client_config" "current" {}


# Resource Group

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
}



# Log Analytics

resource "azurerm_log_analytics_workspace" "main" {
  name                = var.log_analytics_workspace_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}



# Application Insights

resource "azurerm_application_insights" "main" {
  name                = var.application_insights_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.main.id
}



# PostgreSQL Flexible Server

resource "azurerm_postgresql_flexible_server" "main" {

  name                = var.postgres_server_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  version = "16"

  administrator_login    = var.postgres_admin_username
  administrator_password = var.postgres_admin_password

  sku_name = "B_Standard_B1ms"

  storage_mb = 32768

  backup_retention_days = 7

  zone = "1"

  public_network_access_enabled = true
}



resource "azurerm_postgresql_flexible_server_database" "main" {

  name      = var.postgres_database_name
  server_id = azurerm_postgresql_flexible_server.main.id

  charset   = "UTF8"
  collation = "en_US.utf8"
}



resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {

  name      = var.postgres_firewall_rule_name
  server_id = azurerm_postgresql_flexible_server.main.id

  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}




# Azure Container Registry

resource "azurerm_container_registry" "main" {

  count = var.acr_name != "" ? 1 : 0

  name                = var.acr_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  sku           = "Basic"
  admin_enabled = false
}




# AKS Cluster

resource "azurerm_kubernetes_cluster" "main" {

  name                = var.aks_cluster_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name


  dns_prefix = var.aks_dns_prefix != "" ? var.aks_dns_prefix : var.aks_cluster_name
  linux_profile {

    admin_username = "azureuser"

    ssh_key {
      key_data = var.ssh_public_key
    }

  }



  default_node_pool {

    name       = var.aks_default_node_pool_name
    vm_size    = var.aks_default_node_pool_vm_size
    node_count = var.node_count

  }



  identity {

    type = "SystemAssigned"

  }



  oms_agent {

    log_analytics_workspace_id      = azurerm_log_analytics_workspace.main.id
    msi_auth_for_monitoring_enabled = true

  }



  key_vault_secrets_provider {

    secret_rotation_enabled  = true
    secret_rotation_interval = "5m"

  }

}




# AKS can pull images from ACR

resource "azurerm_role_assignment" "aks_acr_pull" {

  count = var.acr_name != "" ? 1 : 0


  principal_id = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id


  role_definition_name = "AcrPull"


  scope = azurerm_container_registry.main[0].id


  skip_service_principal_aad_check = true

}





# Key Vault

resource "azurerm_key_vault" "main" {

  name                = var.key_vault_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name


  tenant_id = data.azurerm_client_config.current.tenant_id


  sku_name = "standard"


  soft_delete_retention_days = 7

  purge_protection_enabled = false


  rbac_authorization_enabled = true

}





# Terraform identity gets permission to create secrets

resource "azurerm_role_assignment" "kv_sp_secrets_officer" {

  scope = azurerm_key_vault.main.id


  role_definition_name = "Key Vault Secrets Officer"


  principal_id = data.azurerm_client_config.current.object_id

}





# AKS CSI identity reads secrets

resource "azurerm_role_assignment" "kv_aks_csi_secrets_user" {

  scope = azurerm_key_vault.main.id


  role_definition_name = "Key Vault Secrets User"


  principal_id = azurerm_kubernetes_cluster.main.key_vault_secrets_provider[0].secret_identity[0].object_id

}





# Key Vault Secrets

resource "azurerm_key_vault_secret" "api" {

  name = "API"

  value = var.api_key

  key_vault_id = azurerm_key_vault.main.id


  depends_on = [
    azurerm_role_assignment.kv_sp_secrets_officer
  ]

}



resource "azurerm_key_vault_secret" "database_url" {

  name = "DATABASE-URL"


  value = "postgresql://${var.postgres_admin_username}:${var.postgres_admin_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/${var.postgres_database_name}?schema=public&sslmode=require"


  key_vault_id = azurerm_key_vault.main.id


  depends_on = [
    azurerm_role_assignment.kv_sp_secrets_officer
  ]

}




resource "azurerm_key_vault_secret" "appinsights_connection_string" {

  name = "APPINSIGHTS-CONNECTION-STRING"


  value = azurerm_application_insights.main.connection_string


  key_vault_id = azurerm_key_vault.main.id


  depends_on = [
    azurerm_role_assignment.kv_sp_secrets_officer
  ]

}




resource "azurerm_key_vault_secret" "app_title" {

  name = "APP-TITLE"

  value = var.app_title

  key_vault_id = azurerm_key_vault.main.id


  depends_on = [
    azurerm_role_assignment.kv_sp_secrets_officer
  ]

}




resource "azurerm_key_vault_secret" "app_version" {

  name = "APP-VERSION"

  value = var.app_version


  key_vault_id = azurerm_key_vault.main.id


  depends_on = [
    azurerm_role_assignment.kv_sp_secrets_officer
  ]

}




resource "azurerm_key_vault_secret" "port" {

  name = "PORT"

  value = "5000"


  key_vault_id = azurerm_key_vault.main.id


  depends_on = [
    azurerm_role_assignment.kv_sp_secrets_officer
  ]

}