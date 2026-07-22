# ─────────────────────────────────────────────
# General
# ─────────────────────────────────────────────

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}


# ─────────────────────────────────────────────
# Monitoring
# ─────────────────────────────────────────────

variable "log_analytics_workspace_name" {
  type = string
}

variable "application_insights_name" {
  type = string
}


# ─────────────────────────────────────────────
# PostgreSQL
# ─────────────────────────────────────────────

variable "postgres_server_name" {
  type = string
}

variable "postgres_database_name" {
  type = string
}

variable "postgres_admin_username" {
  type = string
}

variable "postgres_admin_password" {
  type      = string
  sensitive = true
}

variable "postgres_firewall_rule_name" {
  type = string
}



# ─────────────────────────────────────────────
# Azure Container Registry
# ─────────────────────────────────────────────

variable "acr_name" {
  type    = string
  default = ""
}



# ─────────────────────────────────────────────
# AKS
# ─────────────────────────────────────────────

variable "aks_cluster_name" {
  type = string
}


variable "aks_dns_prefix" {
  type = string
}


variable "aks_default_node_pool_name" {
  type    = string
  default = "systempool"
}


variable "aks_default_node_pool_vm_size" {
  type    = string
  default = "Standard_DS2_v2"
}


variable "node_count" {
  type    = number
  default = 2
}




# ─────────────────────────────────────────────
# Key Vault
# ─────────────────────────────────────────────

variable "key_vault_name" {
  type = string
}



# ─────────────────────────────────────────────
# Application Secrets
# ─────────────────────────────────────────────

variable "api_key" {
  type      = string
  sensitive = true
}


variable "app_title" {
  type = string
}


variable "app_version" {
  type = string
}

variable "ssh_public_key" {
  type = string
}