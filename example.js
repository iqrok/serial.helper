const __serial = require('./');

const serial = new __serial({
		port: '/dev/ttyUSB0',
		baud: 38400,
		autoreconnect: true,
		autoopen: true,
		debug: true,
	});

serial.on('open', received => {
	console.log(received);
});

serial.on('close', received => {
	console.log(received);
});

serial.on('data', received => {
	console.log(received);
});

serial.on('error', received => {
	console.error(received);
});

const __loop = async () => {
	const send = await serial.request('battery\n');
	//~ const send = await serial.write('battery\n');
	console.log('response', send);

	setTimeout(__loop, 125);
};

__loop();

setTimeout(()=>{
		console.log('finished');
		process.exit(0);
	}, 30000);
