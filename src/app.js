const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model')
const { Op } = require("sequelize");
const { getProfile } = require('./middleware/getProfile');
const e = require('express');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { id } = req.params;
    const { Contract } = req.app.get('models');
    const contract = await Contract.findOne({ where: { [Op.and]: [{ id }, { ClientId: req.profile.id }] } });
    if (!contract) return res.status(404).end();
    res.json(contract);
});


app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const contracts = await Contract.findAll({ where: { [Op.and]: [{ [Op.or]: [{ ClientId: req.profile.id }, { ContractorId: req.profile.id }] }, { status: { [Op.ne]: 'terminated' } }] } });
    if (contracts.length === 0) return res.status(404).end();
    res.json(contracts);
});

app.get('/jobs/unpaid', async (req, res) => {
    const { Job } = req.app.get('models');
    const { Contract } = req.app.get('models');
    let unpaidJobs = [];

    const userJobs = await Job.findAll({ where: { paid: { [Op.not]: true } }, raw: true });

    await Promise.all(userJobs.map(async (job) => {
        const contracts = await Contract.findOne({ where: { id: job.ContractId }, raw: true });
        if (contracts.status === 'in_progress') unpaidJobs.push(job);
    }));

    if (unpaidJobs.length === 0) return res.status(404).end();
    res.json(unpaidJobs);
});

app.post('/balances/deposit/:userId', async (req, res) => {
    const { Job, Profile, Contract } = req.app.get('models');
    const { userId } = req.params;
    const { amount } = req.body;
    const contracts = await Contract.findAll({ where: { ClientId: userId } });
    let totalDebt = 0;

    const amountsToPay = await Promise.all(contracts.map(async (contract) => {
        const jobs = await Job.findAll({ where: { [Op.and]: [{ ContractId: contract.id }, { paid: { [Op.not]: true } }] }, raw: true });
        return prices = jobs.map((job) => job.price);
    }))

    totalDebt = amountsToPay.flat().reduce((a, b) => { return a + b });

    if (amount > ((totalDebt * 25) / 100)) {
        res.status(400).json({ message: `Deposit can not be more than the 25% of the total (${(totalDebt * 25) / 100}) of jobs to pay` }).end();
    } else {
        const userProfile = await Profile.findOne({ where: { id: userId } });
        await Profile.update({ balance: userProfile.balance + amount }, {
            where: {
                id: userId
            }
        });
        res.json({ message: 'Deposit successful' });
    }
})


app.post('/jobs/:job_id/pay', async (req, res) => {
    const { Job, Profile, Contract } = req.app.get('models');
    const { job_id } = req.params;

    const job = await Job.findOne({ where: { id: job_id } });
    const contract = await Contract.findOne({ where: { id: job.ContractId } });
    const client = await Profile.findOne({ where: { id: contract.ClientId }, raw: true });
    const contractor = await Profile.findOne({ where: { id: contract.ContractorId }, raw: true });

    if (client.balance >= job.price) {
        await Profile.update({ balance: client.balance - job.price }, {
            where: {
                id: client.id
            }
        });
        await Profile.update({ balance: contractor.balance + job.price }, {
            where: {
                id: contractor.id
            }
        });

        await Job.update({ paid: true }, {
            where: {
                id: job_id
            }
        });

        await Contract.update({ status: 'terminated' }, {
            where: {
                id: contract.id
            }
        });

        res.json({ message: 'Job paid successfully' });
    } else {
        res.status(400).json({ message: 'Failed to pay job' });
    }
});

app.get('/admin/best-profession', async (req, res) => {
    const { Job, Profile, Contract } = req.app.get('models');
    const { start, end } = req.query;
    let professions = {};

    if (!start && !end) return res.status(400).json({ message: 'Missing parameters start & end' });

    const jobs = await Job.findAll({ where: { [Op.and]: [{ paymentDate: { [Op.gte]: start } }, { paymentDate: { [Op.lte]: end } }] }, raw: true });
    for (let job of jobs) {
        const contract = await Contract.findOne({ where: { id: job.ContractId }, raw: true });
        const contractor = await Profile.findOne({ where: { id: contract.ContractorId }, raw: true });
        professions[contractor.profession] ? professions[contractor.profession] += job.price : professions[contractor.profession] = job.price;
    }

    const max = Math.max(...Object.values(Object.values(professions)));

    const mostEarningProfession = Object.keys(professions).find(key => professions[key] === max);

    if (mostEarningProfession) {
        res.json({ message: `The most earning profession is ${mostEarningProfession} with a total of ${max}` });
    } else {
        res.status(400).end();
    }
});


app.get('/admin/best-clients', async (req, res) => {
    const { Job, Profile, Contract } = req.app.get('models');
    const { start, end, limit = 2 } = req.query;

    const clientsArray = [];

    if (!start && !end) return res.status(400).json({ message: 'Missing parameters start & end' });

    const jobs = await Job.findAll({ where: { [Op.and]: [{ paymentDate: { [Op.gte]: start } }, { paymentDate: { [Op.lte]: end } }] }, raw: true });
    for (let job of jobs) {
        const contract = await Contract.findOne({ where: { id: job.ContractId }, raw: true });
        const client = await Profile.findOne({ where: { id: contract.ClientId }, raw: true });

        let profile = clientsArray.find(profile => profile.id === client.id);
        if (!profile) {
            clientsArray.push({ id: client.id, fullName: `${client.firstName} ${client.lastName}`, paid: job.price});
        } else {
            profile.paid += job.price;
        }
    }

    if (clientsArray.length > 0) {
        res.json(clientsArray.sort( (a,b) => b.paid - a.paid).slice(0, limit));
    } else {
        res.status(400).end();
    }

})


module.exports = app;
