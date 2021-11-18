// Includes
const { Client } = require('pg');
const config = require('./config.js');
const fs = require('fs');
const axios = require('axios');

// Connect to DB
const client = new Client({
	user: config.postgres.username,
	host: config.postgres.host,
	database: config.postgres.database,
	password: config.postgres.password,
	port: config.postgres.port,
});
client.connect();

// Define objects to be used
let addresses = {};
let spaces = {};
let sites = {};

// Run query promise chain
client
	.query('SELECT * from site_addresses')
	.then((res) => {
		res.rows.forEach((row) => {
			addresses[row.id.toString()] = row;
		});
		console.log("[1/7] Completed Stage 'Site addresses'");
		return client.query('SELECT * from sites');
	})
	.then((res) => {
		res.rows.forEach((row) => {
			sites[row.id.toString()] = row;
			if (row.address_id != null) {
				sites[row.id.toString()].address = addresses[row.address_id.toString()];
			}
			sites[row.id.toString()].spaces = [];
			sites[row.id.toString()].features = [];
			
		});
		console.log("[2/7] Completed Stage 'Site list");
		return client.query('SELECT * from site_features');
	})
	.then((result) => {
		result.rows.forEach((row) => {
			if (typeof sites[row.site_id.toString()].features !== 'undefined') {
				sites[row.site_id.toString()].features.push(row.feature_id);
			} else {
				console.log(row.site_id.toString());
			}
		});
		console.log("[3/7] Completed Stage 'Site features'");
		return client.query('SELECT * from spaces');
	})
	.then((res) => {
		res.rows.forEach((row) => {
			spaces[row.id.toString()] = row;
			spaces[row.id.toString()].features = [];
		});
		console.log("[4/7] Completed Stage 'Spaces list'");
		return client.query('SELECT * from space_features');
	})
	.then((result) => {
		result.rows.forEach((row) => {
			if (typeof spaces[row.space_id.toString()].features !== 'undefined') {
				spaces[row.space_id.toString()].features.push(row.feature_id);
			} else {
				console.log(row.space_id.toString());
			}
		});
		console.log("[5/7] Completed Stage 'Spaces features'");
		return client.query('SELECT * from prices');
	})
	.then((result) => {
		result.rows.forEach((row) => {
			spaces[row.space_id.toString()].price = row;
		});
		console.log("[6/7] Completed Stage 'Price list'");
		// Map spaces
		for (const [key, value] of Object.entries(spaces)) {
			sites[spaces[key].site_id].spaces.push(spaces[key]);
		}

		// Mapping
		let finalMapping = [];
		for (const [key, value] of Object.entries(sites)) {
			if (sites[key].address_id != null) {
				let tempMapping = {
				id: sites[key].id,
				name: {
					en: sites[key].name_en,
					th: sites[key].name_th,
					kr: sites[key].name_kr,
					jp: sites[key].name_jp,
				},
				description: {
					en: sites[key].description_en,
					th: sites[key].description_th,
					kr: sites[key].description_kr,
					jp: sites[key].description_jp,
				},
				property_type: sites[key].property_type_id,

				stock_management_type: sites[key].stock_management_type,

				images: sites[key].images,
				is_featured: sites[key].is_featured,
				status: sites[key].status,
				address: {
					country_id: sites[key].address.country_id,
					city_id: sites[key].address.city_id,
					district_id: sites[key].address.district_id,
					street: sites[key].address.street,
					postal_code: sites[key].address.postal_code,
					geo_location: {
					lon: sites[key].address.lng || 0,
					lat: sites[key].address.lat || 0,
					},
				},
				features: sites[key].features,
				total_active_spaces: sites[key].spaces.filter((space) => !!space.price)
					.filter((space) => space.status === 'ACTIVE').length,
				spaces: [],
				};
				sites[key].spaces.forEach((space) => {
					if (typeof space.price !== 'undefined') {
						let tempSpace = {
							id: space.id,
							name: space.name,
							size: space.size,
							height: space.height,
							width: space.width,
							length: space.length,
							size_unit: space.size_unit,
							dimensions_unit: space.dimensions_unit,
							description: space.description,
							status: space.status,
							available_units: space.available_units,
							total_units: space.total_units,
							space_type: space.platform_space_type_id,
							price: {
								pre_day: +space.price.price_per_day || 0,
								pre_week: +space.price.price_per_week || 0,
								pre_month: +space.price.price_per_month || 0,
								pre_year: +space.price.price_per_year || 0,
								currency: space.price.currency,
								currency_sign: space.price.currency_sign,
								type: space.price.type,
								start_date: space.price.start_date,
								end_date: space.price.end_date,
							},
							features: space.features,
						};
						tempMapping.spaces.push(tempSpace);
					}
				});
				finalMapping.push(tempMapping);
				axios
					.post(
						config.elasticsearch.server +
							'/' +
							config.elasticsearch.index +
							'/_doc',
						tempMapping
					)
					.then((result) => {
						if (typeof result.data._id != 'undefined') {
							console.log('Added row with id: ' + result.data._id);
						} else {
							console.error(result.data);
						}
					})
					.catch((error) => {
						console.error({
							error: JSON.stringify(error.response.data.error),
							code: error.response.status,
							title: error.response.statusText,
							errored_site: tempMapping.id,
						});
					});
			}
		}
		// Store random one for testing reasons
		//fs.writeFileSync('./debug-data.json', JSON.stringify(finalMapping[100]), 'utf-8');
	})
	.catch((e) => console.error(e.stack));
