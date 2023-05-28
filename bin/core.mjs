import fs from 'fs';
import path from 'path';

async function get_command_module(command) {
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const extensions = ['js', 'mjs'];
    let command_path = '';
    for (const extension of extensions) {
        command_path = path.join(__dirname, 'commands', command + '.' + extension);
        if (fs.existsSync(command_path)) {
            break;
        }
    }
    command_path = command_path.replace(__dirname, '').substring(1);
    if (!fs.existsSync(command_path)) {
        console.log('Command not found.');
        process.exit(1);
    }
    return await import('file://' + command_path);;
}

function get_config(project_dir) {
    const config_path = path.join(project_dir, 'config.json');

    if (!fs.existsSync(config_path)) {
        console.log('Config file not found.');
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(config_path, 'utf8'));

    return config;
}

function get_files(project_dir) {
    const files = []
    const get_files = function (dir) {
        const dir_files = fs.readdirSync(dir);
        dir_files.forEach(function (file) {
            const file_path = path.join(dir, file);
            const file_stat = fs.statSync(file_path);
            if (file_stat.isDirectory()) {
                get_files(file_path);
            } else {
                files.push(file_path);
            }
        });
    }
    get_files(project_dir);
    return files;
}

export {
    get_command_module,
    get_config,
    get_files
};