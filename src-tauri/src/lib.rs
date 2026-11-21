mod cat;
mod diag;
mod local;
mod probe;
mod short;
mod sync;
mod update;
mod stream_proxy;
mod sys;
mod tmdb;
mod xtream;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(cat::CatState::default())
    .manage(xtream::XtreamState::default())
    .manage(short::ShortState::default())
    .setup(|app| {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
      // 先收掉上一次退出/崩溃遗留的 CAT node 孤儿进程，再绑定流代理，
      // 否则孤儿若误占 9989 会和本地流代理抢端口。
      cat::kill_stale_engine(app.handle());
      stream_proxy::spawn();
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      cat::cat_start,
      cat::cat_proxy,
      cat::cat_status,
      cat::cat_stop,
      cat::cat_open_config,
      cat::cat_active_url,
      cat::cat_probe,
      tmdb::tmdb_get_config,
      tmdb::tmdb_set_config,
      tmdb::tmdb_test,
      tmdb::tmdb_rankings,
      local::scan_media_dir,
      local::pick_media_folder,
      local::tmdb_search,
      local::find_subtitles,
      local::read_subtitle_b64,
      probe::probe_url,
      short::sd_start,
      short::sd_new,
      short::sd_search,
      short::sd_series,
      short::sd_episodes,
      short::sd_prepare,
      short::sd_queue,
      short::sd_queue_add,
      short::sd_queue_clear,
      short::sd_runtime,
      short::sd_install_runtime,
      diag::diag_info,
      diag::diag_log_tail,
      diag::diag_export,
      diag::short_cache_list,
      diag::short_cache_clear,
      update::update_check,
      short::sd_status,
      sync::webdav_get_config,
      sync::webdav_set_config,
      sync::webdav_upload,
      sync::webdav_download,
      sync::webdav_test,
      probe::export_backup,
      probe::pick_backup_file,
      probe::read_backup_file,
      xtream::xtream_login,
      xtream::xtream_categories,
      xtream::xtream_live_streams,
      xtream::xtream_vod_streams,
      xtream::xtream_series,
      xtream::xtream_series_info,
      xtream::xtream_epg,
      xtream::http_get_text,
      sys::open_url,
      sys::has_app,
      sys::available_players,
      sys::open_in_player,
      sys::notify,
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
