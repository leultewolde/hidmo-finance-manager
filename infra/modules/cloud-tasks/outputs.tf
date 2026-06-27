output "queue_names" {
  value = {
    for name, queue in google_cloud_tasks_queue.this : name => queue.name
  }
}

