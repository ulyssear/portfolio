import {get_command_module} from './core.mjs';
    
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const options = args.slice(1);

    const command_module = await get_command_module(command);
    command_module.default(options);
}

main();