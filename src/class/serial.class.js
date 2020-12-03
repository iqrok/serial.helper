const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');
const InterByteTimeout = require('@serialport/parser-inter-byte-timeout');
const EventEmitter = require('events');

/**
 *	Change data type to write to serial port
 *	@param {string|number|number[]} data - data to write
 */
function determineData(data){
	if(Array.isArray(data)){
		return Buffer.from(data);
	}

	if(Number.isInteger(data)){
		return Buffer.from([data]);
	}

	if(data === undefined || data === null || data === false){
		return Buffer.from([0]);
	}

	if(data === true){
		return Buffer.from([1]);
	}

	return String(data);
}

/**
 * Async sleep function.
 * @param ms Amount to sleep in milliseconds.
 */
function sleep(ms){
	return new Promise(resolve => setTimeout(resolve, ms))
};

'use strict;'
class serial extends EventEmitter {
	/**
	 *	Constructor
	 *	@param {Object} config - Serial configuration
	 *	@param {string} config.port - Path to serial port
	 *	@param {number} config.baud - Baud Rate for serial communication
	 *	@param {boolean} [config.autoreconnect=true] - Autoreconnect on lost connection
	 *	@param {boolean} [config.autoopen=true] - Auto open port on creating class
	 *	@param {number} [config.reconnectInterval=3000] - Interval in ms for reconnecting if autoreconnect is true
	 *	@param {boolean} [debug=false] - Print debug message
	 */
	constructor(config, debug = false ) {
		super();
		const self = this;

		self.conf = config;
		self.conf.autoreconnect = self.conf.autoreconnect == null ? true : self.conf.autoreconnect;
		self.conf.autoopen = self.conf.autoopen == null ? true : self.conf.autoopen;
		self.reconnectInterval = self.conf.reconnectInterval || 3000;
		self.debug = self.conf.debug != null ? self.conf.debug : debug;

		self.isOpen = false;

		if(self.conf.autoopen){
			this.connect();
		}
	}

	/**
	 *	soft reset for arduino leonardo
	 *	@param {boolean} [baudRate=1200] - baud rate for executing soft reset, should be 1200bps for leonardo
	 */
	softReset(baudRate = 1200){
		const self = this;

		return new Promise(async (resolve, reject) => {
			try{
				const leonardo = new SerialPort(self.conf.port, {baudRate});

				leonardo.on('error', async error => {
					await sleep(100);
					return resolve(self.softReset());
				});

				await sleep(100);
				leonardo.close();
				await sleep(100);

				return resolve(true);
			} catch(error){
				return resolve(self.softReset());
			}
		});
	};

	/**
	 *	write data to serial port
	 *	@param {string|number|number[]} data - data to write
	 *	@param {string} [encoding='utf8'] - data will be encoded according to this encoding
	 */
	write(data, encoding = 'utf8'){
		const self = this;

		return new Promise((resolve, reject) => {
			data = determineData(data);

			// write data to serial port
			self.port.write(data, encoding, error => {
				if(error){
					if(self.debug){
						console.error('serial write error : ', error);
					}

					self.emit('error', error);
					resolve(false);
					return;
				}
			});
			// wait until serial to finish transmitting to the target serial port
			self.port.drain(() => {
				if(self.debug == 'verbose' || self.debug == 2){
					console.log('serial write data: ', data);
				}

				resolve(true);
				return;
			});
		});
	};

	/**
	 *	write string to serial port
	 *	@param {string} msg - string to write
	 */
	print(msg){
		const self = this;
		return self.write(msg);
	}

	/**
	 *	write string to serial port with trailing newline
	 *	@param {string} msg - string to write
	 */
	println(msg){
		const self = this;
		return self.print(msg+'\n');
	}

	/**
	 *	Register all event listeners
	 */
	_registerListeners(){
		const self = this;

		self.port.on('close', () => {
			self.isOpen = false;

			if(self.conf.autoreconnect === true){
				setTimeout(async () => {
						if(self.debug){
							console.error(`Attempting to reconnect ${self.conf.port}[${self.conf.baud}bps]...`);
						}
						await self.connect();
					}, self.reconnectInterval);
			}

			self.emit('close', self.conf.port + ' is closed');
		});

		self.port.on('error', error => {
			self.emit('error', error);
		});

		self.port.on('open', () => {
			self.isOpen = true;
			self.emit('open', 'Connected to:' + self.conf.port + ' baudrate:' + self.conf.baud + 'bps');
		});

		self.registerDataListener();
	};

	/**
	 *	Connect to serial port
	 */
	async connect(){
		const self = this;

		if(self.conf.softReset){
			await self.softReset();
			self.conf.softReset = false;
		}

		return new Promise((resolve, reject) => {
			self.port = new SerialPort(self.conf.port, {
						baudRate: parseInt(self.conf.baud)
					},
					function (error) {
						if(error) {
							if(self.debug){
								self.emit('error', error);
							}

							if(self.conf.autoreconnect === true){
								setTimeout(()=>{
										if(self.debug){
											console.error(`Attempting to reconnect ${self.conf.port}[${self.conf.baud}bps]...`);
										}

										resolve(self.connect());
									}, self.reconnectInterval);
							} else{
								reject(error);
							}
							return;
						}

						resolve(true);
						return;
					}
				);

			self._registerListeners();
		});
	}

	/**
	 *	Register Data Parser Listener & Emitter
	 */
	registerDataListener(){
		const self = this;

		if(self.conf.parser && self.conf.parser.type === 'InterByteTimeout'){
			if(self._parser == undefined){
				const interval = self.conf.parser && self.conf.parser.interval ? self.conf.parser.interval : 30;
				self._parser = self.port.pipe(new InterByteTimeout({interval}));
			}

			self._parser.on('data', received => {
				self.emit('data', received);
			});
		} else{
			if(self._parser == undefined){
				const delimiter = self.conf.parser && self.conf.parser.delimiter ? self.conf.parser.delimiter : '\n';
				self._parser = self.port.pipe(new Readline(delimiter));
			}

			self._parser.on('data', data => {
				let response = {};

				// remove trailing whitespace
				data = data.trim();

				try {
					response = {
							status : true,
							data : JSON.parse(data),
						};
				}
				catch (err) {
					response = {
						status : true,
						data : data,
						ascii : Buffer.from(data),
					}
				}

				// only emit data if it's not empty or if it's an integer (cos 0 means false too)
				/** somehow '' means false in JS **/
				if(response.data || Number.isInteger(response.data)){
					self.emit('data',response);
				}
			});
		}
	}

	/**
	 *	Remove Data Parser Listener & Emitter
	 */
	removeDataListener(){
		const self = this;

		if(self._parser != undefined && self._parser.listenerCount('data') > 0){
			self._parser.removeAllListeners('data');
		}
	};

	/**
	 *	request data to serial port by sending specific commands and wait for the response
	 *	@param {string|number|number[]} data - data to write
	 *	@param {string} [encoding='utf8'] - data will be encoded according to this encoding
	 *	@resturn {Promise} - will resolve until data is received
	 */
	request(data, encoding = 'utf8'){
		const self = this;
		self.removeDataListener();
		return new Promise((resolve, reject) => {
			data = determineData(data);

			// write data to serial port
			self.port.write(data, encoding, error => {
				if(error){
					if(self.debug){
						console.error('serial write error : ', error);
					}

					self.emit('error', error);
					resolve(false);
					return;
				}
			});

			if(self.conf.parser && self.conf.parser.type === 'InterByteTimeout'){
				if(self._parser == undefined){
					const interval = self.conf.parser && self.conf.parser.interval ? self.conf.parser.interval : 30;
					self._parser = self.port.pipe(new InterByteTimeout({interval}));
				}

				self._parser.once('data', received => {
					resolve(received);
				});
			} else {
				if(self._parser == undefined){
					const delimiter = self.conf.parser && self.conf.parser.delimiter ? self.conf.parser.delimiter : '\n';
					self._parser = self.port.pipe(new Readline(delimiter));
				}

				self._parser.once('data', data => {
					let response = {};

					// remove trailing whitespace
					data = data.trim();

					try {
						response = {
								status : true,
								data : JSON.parse(data),
							};
					}
					catch (err) {
						response = {
							status : true,
							data : data,
							ascii : Buffer.from(data),
						}
					}

					// only emit data if it's not empty or if it's an integer (cos 0 means false too)
					/** somehow '' means false in JS **/
					if(response.data || Number.isInteger(response.data)){
						resolve(response);
					}
				});
			}
		});
	};
}

module.exports = serial;
