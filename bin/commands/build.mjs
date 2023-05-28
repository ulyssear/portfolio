import fs from "fs";
import path from "path";
import { get_config, get_files } from "../core.mjs";
import fetch from "node-fetch";
import zlib from "zlib";

const project_dir = process.cwd();
const config = get_config(project_dir);
let files = get_files(project_dir, config);

const output_dir = path.join(project_dir, config?.build?.output_dir || "build");

function execute(options) {
  const start_date = new Date();

  console.log("Build started...");

  if (!fs.existsSync(output_dir)) {
    fs.mkdirSync(output_dir, { recursive: true });
  }

  if (config?.build?.exclude) {
    let { exclude } = config.build;

    exclude = exclude.map(function (exclude_path) {
      return path.join(project_dir, exclude_path);
    });

    files = files.filter(function (file_path) {
      let is_excluded = false;
      exclude.forEach(function (exclude_path) {
        if (exclude_path.includes("*")) {
          const exclude_path_parts = exclude_path.split("*");
          const exclude_path_start = exclude_path_parts[0];
          const exclude_path_end = exclude_path_parts[1];
          if (
            file_path.startsWith(exclude_path_start) &&
            file_path.endsWith(exclude_path_end)
          ) {
            is_excluded = true;
            return;
          }
        }

        if (file_path.startsWith(exclude_path)) {
          is_excluded = true;
          return;
        }
      });
      return !is_excluded;
    });

    const promises = [];
    for (const file of files) {
      promises.push(build_file(file));
    }

    Promise.all(promises).then(function () {
      const end_date = new Date();
      const time_diff = end_date.getTime() - start_date.getTime();
      console.log(`Build finished in ${time_diff} ms.`);
      const index_html_file = path.join(output_dir, "index.html");
      const index_html_file_size = fs.statSync(index_html_file).size;
      const index_html_file_size_mb =
        index_html_file_size > 1024 * 1024
          ? (index_html_file_size / (1024 * 1024)).toFixed(2) + " MB"
          : index_html_file_size > 1024
          ? (index_html_file_size / 1024).toFixed(2) + " KB"
          : index_html_file_size + " B";
      console.log(`File size of index.html: ${index_html_file_size_mb}`);
      const index_html_file_content = fs.readFileSync(index_html_file);
      const index_html_file_content_gzip = zlib.gzipSync(
        index_html_file_content
      );
      fs.writeFileSync(
        path.join(output_dir, "index.html.gz"),
        index_html_file_content_gzip
      );
      const index_html_file_gzip = path.join(output_dir, "index.html.gz");
      const index_html_file_gzip_size = fs.statSync(index_html_file_gzip).size;
      const index_html_file_gzip_size_mb =
        index_html_file_gzip_size > 1024 * 1024
          ? (index_html_file_gzip_size / (1024 * 1024)).toFixed(2) + " MB"
          : index_html_file_gzip_size > 1024
          ? (index_html_file_gzip_size / 1024).toFixed(2) + " KB"
          : index_html_file_gzip_size + " B";
      console.log(
        `File size of index.html.gz: ${index_html_file_gzip_size_mb}`
      );
    });

    if (options.includes("--watch")) {
      console.log("Watching files...");
      const files_listen = [];
      files.forEach(function (file) {
        fs.watch(file, function (event_type, file_name) {
          if (files_listen.includes(file)) return;
          console.log("Changes detected in file: " + file_name + ".");
          const start_date = new Date();
          files_listen.push(file);
          build_file(file).then(function () {
            const end_date = new Date();
            const time_diff = end_date.getTime() - start_date.getTime();
            console.log(`File ${file_name} built in ${time_diff} ms.`);
            files_listen.splice(files_listen.indexOf(file), 1);
          });
        });
      });
    }
  }
}

async function build_file(file) {
  const file_extension = path.extname(file).substring(1);

  const methods = {
    html: build_html,
    js: build_js,
  };

  if (methods[file_extension]) {
    return await methods[file_extension](file);
  }

  const file_content = fs.readFileSync(file, "utf8");
  save_file(file, file_content);
}

async function build_html(file) {
  const html = fs.readFileSync(file, "utf8");
  let html_minified = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();

  const js_regex = /<script[^>]*>([\s\S]*?)<\/script>/;
  let scripts = html.match(new RegExp(js_regex, "g")) || [];

  for (const script of scripts) {
    const script_content = script.match(js_regex)[1];
    const script_minified = minify_js(script_content);
    html_minified = html_minified
      .replace(script_content, script_minified)
      .trim();
  }

  const js_src_regex = /<script[^>]*src="([^"]*)"[^>]*><\/script>/;
  scripts = html.match(new RegExp(js_src_regex, "g")) || [];
  for (const script of scripts) {
    const script_src = script.match(js_src_regex)[1];
    const script_src_file = script_src.startsWith("http")
      ? script_src
      : path.join(project_dir, script_src);
    let script_src_content = "";
    try {
      script_src_content = fs.readFileSync(script_src_file, "utf8");
    } catch (e) {
      script_src_content = await fetch(script_src_file).then((response) =>
        response.text()
      );
    }
    const script_src_minified = minify_js(script_src_content);
    const script_src_base64 =
      Buffer.from(script_src_minified).toString("base64");
    html_minified = html_minified.replace(
      script_src,
      `data:text/javascript;base64,${script_src_base64}`
    );
  }

  const links_href_regex = /<link[^>]*href="([^"]*)"[^>]*>/;
  const links = html.match(new RegExp(links_href_regex, "g")) || [];
  for (const link of links) {
    if (!link.includes("stylesheet")) continue;
    const link_href = link.match(links_href_regex)[1];
    const link_href_file = link_href.startsWith("http")
      ? link_href
      : path.join(project_dir, link_href);
    let link_href_content = "";
    try {
      link_href_content = fs.readFileSync(link_href_file, "utf8");
    } catch (e) {
      link_href_content = await fetch(link_href_file).then((response) =>
        response.text()
      );
    }
    const link_href_minified = await minify_css(link_href_content);
    const link_href_base64 = Buffer.from(link_href_minified).toString("base64");
    html_minified = html_minified
      .replace(link_href, `data:text/css;base64,${link_href_base64}`)
      .trim();
  }

  const links_preconnect_regex = /<link[^>]*rel="preconnect"[^>]*>/;
  const links_preconnect =
    html.match(new RegExp(links_preconnect_regex, "g")) || [];
  for (const link of links_preconnect) {
    html_minified = html_minified.replace(link, "").trim();
  }

  const img_regex = /<img[^>]*src="([^"]*)"[^>]*>/;
  const imgs = html.match(new RegExp(img_regex, "g")) || [];
  for (const img of imgs) {
    const img_src = img.match(img_regex)[1];
    const img_src_file = img_src.startsWith("http")
      ? img_src
      : path.join(project_dir, img_src);

    let img_src_content = "";
    let extension = "";
    let img_src_base64 = "";
    let mime = "";
    try {
      img_src_content = fs.readFileSync(img_src_file, "utf8");
      extension = path.extname(img_src_file).substring(1);
      mime = get_mime(extension);
      img_src_base64 = Buffer.from(img_src_content).toString("base64");
    } catch (e) {
      try {
        img_src_content = await fetch(img_src_file).then((response) => {
          mime = response.headers.get("content-type");
          return response.arrayBuffer();
        });
        img_src_base64 = Buffer.from(img_src_content).toString("base64");
      } catch (e) {}
    }
    html_minified = html_minified
      .replace(img_src, `data:${mime};base64,${img_src_base64}`)
      .trim();
  }

  html_minified = html_minified.replace(/\n/g, "").trim();
  html_minified = html_minified.replace(/\s+/g, " ").trim();

  save_file(file, html_minified);
}

function get_mime(type) {
  const mimes = {
    css: "text/css",
    js: "text/javascript",
    html: "text/html",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    eot: "font/eot",
    otf: "font/otf",
  };
  return mimes[type] || "text/plain";
}

async function build_js(file) {
  const js = fs.readFileSync(file, "utf8");

  const js_minified = minify_js(js);
  save_file(file, js_minified);
}

function build_json(file, save = false) {
  let json;
  if ("object" === typeof file && !Array.isArray(file)) {
    json = file;
  }
  if (!json) {
    try {
      json = fs.readFileSync(
        file + (!file.endsWith(".json") ? ".json" : ""),
        "utf8"
      );
    } catch (e) {
      try {
        json = fetch(file).then((response) => response.text());
      } catch (e) {
        console.log(`JSON '${file}' not found`);
        return;
      }
    }
  }

  const image_properties = [
    "logo",
    "image",
    "icon",
    "cover",
    "icons",
    "avatar",
    "socials",
  ];

  if ("string" === typeof json) {
    json = JSON.parse(json);
  }

  for (const property in json) {
    if (is_2D_list(json[property])) {
      const properties = json[property][0];
      const image_properties_index = properties
        .map((item, index) => (image_properties.includes(item) ? index : null))
        .filter((item) => item !== null);
      for (const row of json[property].slice(1)) {
        for (const index of image_properties_index) {
          row[index] = load_image(row[index]);
        }
      }
    } else if (
      image_properties.includes(property) &&
      "string" === typeof json[property]
    ) {
      json[property] = load_image(json[property]);
    } else if (
      "object" === typeof json[property] &&
      image_properties.includes(property)
    ) {
      for (const key in json[property]) {
        json[property][key] = load_image(json[property][key]);
      }
    } else if (
      "object" === typeof json[property] &&
      !Array.isArray(json[property])
    ) {
      json[property] = build_json(json[property]);
    }
  }

  if (save) save_file(file + ".lock", JSON.stringify(json));

  return json;

  function is_2D_list(value) {
    return (
      Array.isArray(value) &&
      Array.isArray(value[0]) &&
      value[0].every((item) => "string" === typeof item)
    );
  }

  function load_image(file) {
    if (!file) return;
    let file_logo, mime, encoded, extension;
    try {
      file_logo = fs.readFileSync(path.join(project_dir, file));
      extension = path.extname(file).slice(1);
      mime = get_mime(extension);
      encoded = file_logo.toString("base64");
    } catch (e) {
      try {
        file_logo = fetch_sync(file);
        extension = file.split(".").pop();
        mime = get_mime(extension);
        encoded = file_logo.toString("base64");
      } catch (e) {
        console.log(`Image '${file}' not found`);
        return;
      }
    }
    return `data:${mime};base64,${encoded}`;
  }
}

function fetch_sync(url) {
  return Promise.resolve(
    fetch(url)
      .then((response) => {
        resolve(response);
      })
      .catch((e) => {})
  );
}

function minify_json(content) {
  if ("string" === typeof content) {
    content = JSON.parse(content);
  }
  return JSON.stringify(content);
}

function minify_js(content) {
  content = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "");
  const require_json_regex = /import_json\(['"]([\w\/]*)['"]\)(?!\s+\{)/g;
  const require_json = content.match(require_json_regex) || [];
  for (const require of require_json) {
    const file = require.match(/import_json\(['"]([\w\/]*)['"]\)(?!\s+\{)/)[1];
    const file_path = path.join(project_dir, file);
    const file_content = build_json(file_path, false);
    const file_content_minified = minify_json(file_content);
    content = content.replace(require, file_content_minified);
  }
  const function_regex = /function\s+([\w\$]+)/g;
  const functions = content.match(new RegExp(function_regex, "g")) || [];
  const dict_functions = {};
  for (const func of functions) {
    const func_name = func.match(/function\s+([\w\$]+)/)[1];
    const called_regex = new RegExp(`(?<!function\\s)${func_name}\\(`, "g");
    const called = content.match(new RegExp(called_regex, "g")) || [];
    if (called.length === 0) {
      let func_content = "";
      let func_level = 0;
      let i = content.indexOf(func);
      while (i < content.length) {
        func_content += content[i];
        if (content[i] === "{") {
          func_level++;
        } else if (content[i] === "}") {
          func_level--;
          if (func_level === 0) {
            break;
          }
        }
        i++;
      }
      content = content.replace(func_content, "");
    } else {
      const index = Object.keys(dict_functions).length;
      const compact_name = (function (index) {
        const letters = [];
        if (0 === index) {
          letters.push("a");
        }
        while (index > 0) {
          letters.push(String.fromCharCode((index % 26) + 97));
          index = Math.floor(index / 26);
        }
        letters.push("f");
        return letters.reverse().join("");
      })(index);
      let func_content = "";
      let func_level = 0;
      let i = content.indexOf(func);
      while (i < content.length) {
        func_content += content[i];
        if (content[i] === "{") {
          func_level++;
        } else if (content[i] === "}") {
          func_level--;
          if (func_level === 0) {
            break;
          }
        }
        i++;
      }

      const old_func_content = func_content;
      func_content = func_content.replace(
        new RegExp(`function\\s+${func_name}\\s*\\(`),
        `function ${compact_name}(`
      );
      content = content.replace(old_func_content, func_content);
      content = content.replace(
        new RegExp(`\\b${func_name}\\b`, "g"),
        compact_name
      );
      dict_functions[func_name] = compact_name;
    }
  }
  content = content.replace(/\n/g, "");
  content = content.replace(/\s+/g, " ");
  return content;
}

async function minify_css(content) {
  content = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "");

  const url_regex = /url\(['"]?([^'"\)]*)['"]?\)/;
  const urls = content.match(new RegExp(url_regex, "g")) || [];
  for (const url of urls) {
    const url_file = url.match(url_regex)[1];
    const url_file_path = url_file.startsWith("http")
      ? url_file
      : path.join(project_dir, url_file);
    let url_file_content = "";
    let extension = "";
    let url_file_base64 = "";
    try {
      url_file_content = fs.readFileSync(url_file_path, "utf8");
      extension = path.extname(url_file_path).substring(1);
      url_file_base64 = Buffer.from(url_file_content).toString("base64");
    } catch (e) {
      url_file_content = await fetch(url_file_path).then((response) => {
        extension = response.headers.get("content-type").split("/")[1];
        return response.arrayBuffer();
      });
      url_file_base64 = Buffer.from(url_file_content).toString("base64");
    }
    const mime = get_mime(extension);
    content = content.replace(
      url,
      `url(data:${mime};base64,${url_file_base64})`
    );
  }

  content = content.replace(/\n/g, "");
  content = content.replace(/\s+/g, " ");

  return content;
}

function save_file(file, content) {
  const output_file = path.join(output_dir, file.replace(project_dir, ""));
  const output_file_dir = path.dirname(output_file);
  if (!fs.existsSync(output_file_dir)) {
    fs.mkdirSync(output_file_dir, { recursive: true });
  }
  fs.writeFileSync(output_file, content, "utf8");
}

export default execute;
